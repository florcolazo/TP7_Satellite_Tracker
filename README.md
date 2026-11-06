# 🛰️ Satellite Tracker

**TP N° 7 — Programación Móviles 2026 · Licenciatura en Sistemas de Información · FCyT-UADER**

App móvil en **React Native (Expo)** que calcula en el teléfono, con **SGP4/SDP4**, la posición de satélites reales (LEO, MEO, GEO y HEO). Los muestra en un mapa mundial con ground track, footprint y la constelación Starlink, predice sus pases sobre la ubicación del usuario con un sky chart polar, avisa antes de cada pase y ayuda a apuntarles con la brújula del teléfono.

| Mapa en tiempo real | Pases y sky chart | Brújula | Validación |
|---|---|---|---|
| Ground track con corte en el antimeridiano, footprint, constelación agrupada | AOS/MAX/LOS, visible a simple vista ✨, Doppler y FSPL | Rumbo verdadero + inclinación, guía háptica | Error en km contra N2YO y Where the ISS at? |

---

## Puntos destacados

- **Predictor de pases con cota física**: paso adaptativo derivado de la velocidad angular máxima posible, más bisección y sección dorada. Usa **×53 a ×913 menos propagaciones** que la búsqueda ingenua, con AOS/LOS a ±1 s, y está verificado contra fuerza bruta en tests ([doc técnico §3.1](docs/01-documento-tecnico.md#31-predicción-de-ventanas-de-visibilidad-rf-04--passests)).
- **Validación real**: nuestra posición de la ISS coincide con Where the ISS at? a **~2 metros** ([informe](docs/02-informe-validacion.md)).
- **OMM como formato principal**: soporta NORAD de 6 dígitos (580 Starlink ya no tienen TLE).
- **Footprint correcto en cualquier caso**: recorte en el antimeridiano (Sutherland–Hodgman) y footprints que contienen un polo.
- **Capa de datos robusta**: 4 proveedores detrás de una interfaz común, caché SQLite con TTL, rate limiter multi-ventana por API, reintentos con backoff y `Retry-After`, circuit breaker, deduplicación, modo offline con datos vencidos y credenciales en un proxy propio.
- **Telecomunicaciones**: para cada pase se calculan rango, pérdida de espacio libre y Doppler en VHF/UHF/L/Ku.
- **75 + 8 tests automáticos**, TypeScript estricto y ESLint sin advertencias.

## Requisitos funcionales → implementación

| RF | Descripción | Dónde |
|---|---|---|
| RF-01 | Búsqueda por nombre / NORAD ID | `app/src/app/(tabs)/catalog.tsx`, `OrbitalRepository.search` |
| RF-02 | Posición lat/lon/alt con SGP4 local | `app/src/core/orbital/engine.ts` |
| RF-03 | Azimut/elevación respecto del usuario | `engine.ts` (`eciToLookAngles`), tarjeta del mapa |
| RF-04 | Ventanas AOS/MAX/LOS | `app/src/core/prediction/passes.ts`, pestaña Pases |
| RF-05 | Sky chart polar (SVG) | `app/src/components/SkyChart.tsx`, `app/src/app/pass/[aos].tsx` |
| RF-06 | Notificación N minutos antes | `app/src/services/notifications.ts` |
| RF-07 | Modo brújula | `app/src/app/(tabs)/compass.tsx` |
| RF-08 | Filtro por constelación | `app/src/core/data/groups.ts`, chips del catálogo |
| RF-09 | Actualización automática por TTL | `OrbitalRepository`, `app/src/services/background.ts`, `bootstrap.ts` |
| RF-10 | Mapa en tiempo real (1–5 s) | `app/src/app/(tabs)/index.tsx` (refresco 0,5 s) |
| RF-11 | Ground track + antimeridiano | `app/src/core/orbital/groundTrack.ts` |
| RF-12 | Footprint con elevación mínima configurable | `app/src/core/orbital/footprint.ts` |
| RF-13 | Capa de constelación con límite y agrupamiento | `app/src/core/orbital/constellation.ts`, `app/src/hooks/useConstellation.ts` |
| RF-14 | Proveedores, caché y fallback | `app/src/core/data/**`, `app/src/services/sqliteStore.ts` |
| RF-15 | Modo validación con error en km | `app/src/core/validation/compare.ts`, `app/src/app/validation.tsx` |
| RF-16 | Antigüedad de datos y alerta | `app/src/components/DataAgeBadge.tsx` |

## Cómo ejecutarlo

### Requisitos

- Node.js ≥ 23.6 (probado con 24)
- Un teléfono con **Expo Go** (Android o iOS), en la misma red Wi-Fi que la PC

### 1. App (funciona sola, sin credenciales)

```bash
cd app
npm install
npx expo start
```

Escanear el código QR con Expo Go (Android) o con la cámara (iOS). Sin proxy, la app usa CelesTrak y Where the ISS at?: todo funciona salvo el fallback a Space-Track y la validación con N2YO.

### 2. Proxy de credenciales (opcional, para N2YO y Space-Track)

```bash
cd server
cp .env.example .env      # completar N2YO_API_KEY, SPACETRACK_USER/PASS, APP_TOKEN
npm start                 # http://0.0.0.0:8787
```

Y en la app:

```bash
cd app
cp .env.example .env.local
# EXPO_PUBLIC_PROXY_URL=http://<IP-LAN-de-la-PC>:8787
# EXPO_PUBLIC_PROXY_TOKEN=<mismo APP_TOKEN>
npx expo start --clear
```

### 3. Build de prueba (APK)

```bash
cd app
GOOGLE_MAPS_API_KEY=... npx eas-cli@latest build -p android --profile preview
```

En Expo Go el mapa funciona sin clave. Un APK standalone de Android necesita una API key de Google Maps (Maps SDK for Android).

### Tests y calidad

```bash
cd app && npm test && npm run typecheck && npm run lint
cd server && npm test
cd app && npm run bench      # → docs/resultados-benchmark.md
cd app && npm run validate   # → docs/resultados-validacion.md  (N2YO_API_KEY=... para incluir N2YO)
```

## Estructura

```
├── app/                        App React Native (Expo SDK 58, TypeScript)
│   ├── src/core/               Núcleo puro (sin RN): lo usan la app, los tests y los scripts
│   │   ├── orbital/            engine (SGP4), sun, groundTrack, footprint, constellation
│   │   ├── prediction/         passes (AOS/LOS), link (Doppler, FSPL)
│   │   ├── data/               providers/, repository (orquestador), rateLimiter, retry, circuitBreaker, http, store
│   │   ├── validation/         compare (haversine, ECEF, estadísticas)
│   │   └── __tests__/          75 tests + fixtures con elementos reales
│   ├── src/services/           SQLite, notificaciones, background, bootstrap
│   ├── src/app/                Pantallas (Expo Router): mapa, catálogo, pases, brújula, ajustes, pase, validación, proveedores
│   ├── src/components/         SkyChart, DataAgeBadge, UI
│   └── scripts/                validate.ts, bench.ts
├── server/                     Proxy Node.js sin dependencias (credenciales, caché, rate limiting)
└── docs/                       Entregables escritos
```

## Entregables

| Entregable | Ubicación |
|---|---|
| Código fuente en Git | este repositorio |
| Proyecto ejecutable vía Metro / APK | `app/` (ver "Cómo ejecutarlo") |
| Documento técnico (modelo, supuestos, limitaciones) | [docs/01-documento-tecnico.md](docs/01-documento-tecnico.md) |
| Informe de validación | [docs/02-informe-validacion.md](docs/02-informe-validacion.md) + [resultados](docs/resultados-validacion.md) |
| Decisiones sobre fuentes de datos | [docs/03-decisiones-fuentes-datos.md](docs/03-decisiones-fuentes-datos.md) |
| Video demo | guion en [docs/04-guion-video-demo.md](docs/04-guion-video-demo.md) |
| Benchmark de rendimiento | [docs/resultados-benchmark.md](docs/resultados-benchmark.md) |
