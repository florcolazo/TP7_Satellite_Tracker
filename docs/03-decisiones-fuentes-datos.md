# Decisiones sobre fuentes de datos

**TP N° 7 · Satellite Tracker**

Este documento justifica qué fuentes se usan, cómo se respetan sus límites y cómo se comporta la app ante fallas o falta de conectividad.

---

## 1. Fuentes y roles

| Proveedor | Rol en la app | Formato | Autenticación | Acceso desde la app |
|---|---|---|---|---|
| **CelesTrak** | Fuente **principal** de catálogos y elementos orbitales. Starlink vía **SupGP** | OMM/JSON | Ninguna | Directo |
| **Space-Track.org** | **Fallback** de catálogos y elementos | OMM/JSON | Usuario y contraseña (cookie de sesión) | Vía proxy |
| **N2YO** | **Validación** cruzada (cualquier satélite) y TLE de último recurso | JSON / TLE | API key | Vía proxy |
| **Where the ISS at?** | **Validación** de la ISS y TLE de último recurso para la ISS | JSON / TLE | Ninguna | Directo |

### Orden de fallback

| Operación | Cadena |
|---|---|
| Catálogo de un grupo | CelesTrak (SupGP → GP) → Space-Track → *caché vencida* |
| Elementos de un satélite | CelesTrak → Space-Track → N2YO (TLE) → Where the ISS at? (sólo ISS) → *caché vencida* |
| Validación | **todas** las fuentes disponibles, en paralelo (se comparan, no se reemplazan) |

## 2. Starlink: alcance y justificación del set suplementario

**No existe una API pública oficial para consultar las posiciones de la constelación Starlink.**

- Las **APIs Enterprise de Starlink** (cuentas, terminales, routers, telemetría) requieren una cuenta *business* y exponen datos del **servicio del cliente**, no de la constelación.
- La **Space Traffic Coordination API** de SpaceX, que sí intercambia efemérides, está restringida a **operadores satelitales** y requiere autenticación mTLS con un certificado firmado por SpaceX. No es accesible para una aplicación de terceros.

**Decisión: usar los datos SupGP de CelesTrak** (`sup-gp.php?FILE=starlink`). SpaceX publica efemérides de sus satélites (posiciones derivadas de GPS a bordo, con maniobras planificadas) para la coordinación del tráfico espacial. CelesTrak las ajusta a elementos medios compatibles con SGP4 y las publica como OMM.

Ventajas frente al catálogo GP estándar (basado en radar):

1. **Precisión:** parten de posiciones GPS del propio satélite, no de observaciones de radar. Además incorporan maniobras planificadas, algo crítico en una constelación que maniobra frecuentemente. El Experimento 3 del [informe de validación](02-informe-validacion.md) mide la diferencia.
2. **Actualidad:** se generan varias veces por día y aparecen antes para satélites recién lanzados.
3. **Cobertura:** incluyen objetos con NORAD de 6 dígitos sin representación TLE (580 en nuestra descarga).

Limitaciones asumidas: SupGP sigue siendo un ajuste para SGP4 (hereda sus limitaciones) y CelesTrak restringe la descarga a una cada 2 h por IP. Si SupGP no está disponible, el proveedor cae automáticamente al GP estándar de CelesTrak y, después, a Space-Track.

## 3. Límites de uso y cómo se respetan

| Proveedor | Límite publicado | Rate limiter de la app | Otras medidas |
|---|---|---|---|
| CelesTrak | Sin cuota numérica; bloquea IPs que descargan datos sin cambios. SupGP: 1 descarga cada 2 h | 20/min y 200/h | **TTL mínimo de 2 h** (no configurable por debajo), TTL por defecto 12 h, manejo de la respuesta "not-modified" |
| Space-Track | < 30 req/min, < 300 req/h; GP del mismo objeto como mucho 1 vez por hora | 25/min y 280/h (app) + 25/min y 280/h (proxy) | Caché del proxy: 1 h por satélite, 6 h por grupo. Sesión reutilizada 90 min (un login por sesión, no por request) |
| N2YO | 1000 transacciones/h (tle, positions); 100/h (passes, above) | 950/h + intervalo ≥ 250 ms; 95/h para pases | Caché del proxy: TLE 1 h, posiciones 2 s, pases 30 min |
| Where the ISS at? | ~1 req/s; el header `X-Rate-Limit-Limit` informa 350 cada 5 min | 300 cada 5 min + intervalo ≥ 1,1 s | La serie temporal pide 10 instantes en **una** request |

### Implementación

- **`RateLimiter`** ([`rateLimiter.ts`](../app/src/core/data/rateLimiter.ts)): ventana deslizante con **varias ventanas simultáneas**, más un intervalo mínimo opcional. Las llamadas concurrentes se serializan para no conceder de más. Si la espera supera 10 s, falla de inmediato con `rate-limited` y el orquestador pasa al siguiente proveedor en vez de bloquear la UI.
- **`withRetry`** ([`retry.ts`](../app/src/core/data/retry.ts)): backoff exponencial con *full jitter*, `espera = random(0, min(8 s, 0,8 s · 2ⁿ))`, hasta 2 reintentos. Sólo reintenta errores transitorios (red, timeout, 5xx, 429) y **respeta `Retry-After`**. No reintenta 4xx ni datos inválidos.
- **`CircuitBreaker`** ([`circuitBreaker.ts`](../app/src/core/data/circuitBreaker.ts)): tras 3 fallas consecutivas el proveedor queda 5 min en cuarentena y se saltea sin gastar cuota ni tiempo. Después permite una request de prueba (semiabierto).
- **Deduplicación:** dos pantallas que piden el mismo grupo al mismo tiempo generan **una** sola descarga.
- **Pantalla "Proveedores"** (Ajustes → Proveedores): estado del circuito, uso de cada ventana del limiter (con barra) y log en vivo de cada request (status, duración, reintentos, URL sin secretos).

## 4. Caché y operación sin conectividad

### Almacenamiento

SQLite (`expo-sqlite`), con tres tablas:

```
orbital(norad_id PK, name, object_id, elements JSON, epoch, source, dataset, fetched_at)
group_member(grp, norad_id, ord)
group_meta(grp PK, fetched_at, source, dataset, count)
```

Se eligió SQLite y no AsyncStorage porque el catálogo de Starlink (~11 000 objetos, ~5 MB) supera el límite práctico de ~6 MB de AsyncStorage en Android. Además permite buscar por nombre o NORAD con índices. Las inserciones son multi-fila (100 por sentencia) dentro de una transacción.

### Política de frescura

| Situación | Comportamiento |
|---|---|
| Caché con edad < TTL | Se usa directamente: **0 requests** |
| Caché vencida, proveedor responde | Se descarga, se guarda y se usa |
| Caché vencida, CelesTrak responde "not-modified" | La caché **es** el dato vigente: se renueva su marca de tiempo sin descargar ni consultar a otro proveedor |
| Sin caché, CelesTrak responde "not-modified" (IP compartida, p. ej. la red de la facultad) | Se considera una falla de ese origen y se sigue con el próximo (SupGP → GP → Space-Track) |
| Caché vencida, todos los proveedores fallan | Se usa la caché **vencida** marcada `stale`. La app sigue calculando posiciones y pases offline y avisa en la UI |
| Sin caché y todos fallan | Error con el detalle por proveedor |

**Doble marca de tiempo:**

- `fetchedAt` (cuándo se descargó) controla el **TTL de caché** (RF-09);
- `epoch` (época de los elementos) controla la **antigüedad del dato orbital** (RF-16), que es lo que determina la exactitud.

El badge "TLE x h" usa `epoch`: verde < 24 h, ámbar 1–3 días, rojo > 3 días con alerta explicativa.

### Refresco automático (RF-09)

- **Al volver a primer plano:** se refrescan el satélite seleccionado y los grupos usados si su TTL venció.
- **En background** (`expo-background-task`, cada ≥ 60 min según el sistema operativo): se refrescan los grupos usados y los satélites vigilados, y se reprograman sus avisos.
- Toda la actividad automática pasa por el mismo orquestador, así que **también respeta TTL, rate limits y circuit breakers**: el refresco automático no puede exceder los límites de ningún proveedor.

## 5. Manejo de credenciales

**Regla:** ninguna credencial de terceros entra al código fuente ni al bundle de la app. Un APK se descompila en minutos, y una key embebida queda expuesta para siempre.

**Solución: backend proxy propio** ([`server/`](../server)), recomendado por el enunciado:

- `N2YO_API_KEY`, `SPACETRACK_USER` y `SPACETRACK_PASS` viven en `server/.env`, excluido de git (se versiona `.env.example`).
- El proxy agrega la key de N2YO **del lado servidor** y mantiene la cookie de sesión de Space-Track.
- La app sólo conoce `EXPO_PUBLIC_PROXY_URL`, que no es un secreto.
- Un token opcional (`APP_TOKEN` / `EXPO_PUBLIC_PROXY_TOKEN`) evita que el proxy funcione como relay abierto para terceros. No es una credencial de los proveedores: si se filtra, sólo permite usar *nuestro* proxy, que igual está protegido por sus rate limits.
- El proxy **cachea y limita del lado servidor**. La cuota de N2YO y Space-Track es por cuenta y la comparten todos los usuarios de la app, así que el control tiene que ser central.
- El log de requests de la app y del proxy enmascara parámetros sensibles (`apiKey=***`).

**Alternativa evaluada y descartada:** guardar las keys en Keychain/Keystore (`expo-secure-store`). Protege la key *en reposo* en el dispositivo, pero la key igual tiene que llegar al teléfono (la tipea el usuario o viene en el bundle), y cada instalación consumiría cuota por separado. El proxy resuelve ambos problemas.

**Degradación sin proxy:** si `EXPO_PUBLIC_PROXY_URL` no está configurada, Space-Track y N2YO se declaran "no configurados". El orquestador los excluye sin contarlo como falla, y la app funciona completa con CelesTrak y Where the ISS at? (la validación queda limitada a la ISS).

## 6. Hallazgos durante el desarrollo

- **CelesTrak responde HTTP 200 con texto plano en situaciones de error.** "GP data has not updated since your last successful download", "Please limit requests to once every 2 hours" e "Invalid query" llegan con status 200. Un cliente ingenuo que hace `JSON.parse` falla, o peor, reintenta y agrava el bloqueo. `CelesTrakProvider` reconoce esos mensajes y los traduce a errores tipados (`not-modified`, `not-found`, `invalid-data`), cubiertos por tests.
- **N2YO informa errores en el cuerpo** (`{"error": "Invalid API Key!"}`) con status 200. El proxy los traduce a HTTP 502.
- **Where the ISS at? publica su cuota en headers** (`X-Rate-Limit-Limit: 350`, `X-Rate-Limit-Interval: 5 minutes`). El limiter se configuró por debajo de ese valor.
- **NORAD de 6 dígitos:** el 5 % de los Starlink descargados ya no tiene representación TLE. Usar OMM es obligatorio, no opcional.
