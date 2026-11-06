# Informe de validación de posiciones

**TP N° 7 · Satellite Tracker**

Este informe documenta la exactitud de las posiciones que calcula la app (criterio de evaluación de mayor peso, 25 %). Los números provienen de ejecuciones reales del script [`app/scripts/validate.ts`](../app/scripts/validate.ts), que usa **el mismo código** que la app (`src/core`). Los resultados completos y actualizados están en [`resultados-validacion.md`](resultados-validacion.md), y los datos crudos en `data/validacion.json`.

---

## 1. Metodología

### 1.1 Qué se compara

Para cada medición, la fuente externa informa la posición del satélite (lat, lon, altitud y, si corresponde, az/el) con **su** timestamp. Calculamos nuestra posición con SGP4 **en ese mismo instante**, para que la latencia de red no contamine la medición.

### 1.2 Métricas

| Métrica | Definición |
|---|---|
| Error horizontal | Distancia de gran círculo (haversine) entre ambos puntos subsatelitales |
| Error de altitud | h_nuestra − h_referencia |
| **Error 3D** | Distancia euclídea entre ambas posiciones en ECEF (WGS-84). Es la métrica relevante para un enlace: error en el vector al satélite |
| Error de apuntamiento | \|Δaz\| y \|Δel\| vistos desde el observador (sólo N2YO informa az/el) |
| Antigüedad del TLE | Tiempo entre la época de NUESTROS elementos y el instante medido |

### 1.3 Fuentes y su independencia

Es importante interpretar bien qué valida cada comparación.

- **Where the ISS at?** y **N2YO** también propagan con SGP4 a partir del catálogo público GP. Comparar contra ellos **valida nuestra implementación** (lectura de elementos, propagación, GMST, conversión TEME → ECEF → geodésicas, az/el). Si nuestro código tuviera un error de frames, de unidades o de huso horario, aparecerían diferencias de decenas a miles de km. No miden la exactitud de SGP4 respecto de la posición *real*.
- **SupGP de Starlink** se deriva de las **efemérides que publica el operador** (SpaceX, a partir de GPS a bordo). Es una fuente más cercana a la posición real y nos permite estimar el **error del dato GP** público (Experimento 3).

## 2. Resultados

> Ejecución del 2026-11-06 a las 17:48 UTC, observador FCyT-UADER (−32,4846°, −58,2321°).

### Experimento 1 — ISS vs. Where the ISS at?: serie temporal de −48 h a +24 h

Elementos propios: CelesTrak GP (OMM), época 2026-11-05 20:28:36 UTC. Where the ISS at? usa el **mismo set**, pero en formato TLE.

| Offset | Antigüedad TLE | Error horizontal (km) | Error altitud (km) | Error 3D (km) |
|---:|---:|---:|---:|---:|
| −48 h | −26,7 h | 0,095 | 0,032 | **0,107** |
| −24 h | −2,7 h | 0,002 | −0,002 | 0,002 |
| −12 h | 9,3 h | 0,001 | −0,002 | 0,003 |
| −6 h | 15,3 h | 0,001 | −0,002 | 0,002 |
| −1 h | 20,3 h | 0,002 | −0,002 | 0,003 |
| 0 h | 21,3 h | 0,001 | −0,002 | 0,002 |
| +1 h | 22,3 h | 0,001 | −0,002 | 0,002 |
| +6 h | 27,3 h | 0,001 | −0,002 | 0,002 |
| +12 h | 33,3 h | 0,001 | −0,002 | 0,002 |
| +24 h | 45,3 h | 0,002 | −0,002 | 0,003 |

**Error 3D medio: 13 m · RMS: 34 m · máximo: 107 m.**

### Experimento 2 — ISS en vivo (10 muestras consecutivas)

**Error 3D: 2 m en las 10 muestras** (posición de referencia sobre la Patagonia, altitud 435 km).

### Experimento 3 — Starlink: GP (radar) vs. SupGP (efemérides del operador)

Este experimento cuantifica cuánto difiere el catálogo público GP de la solución basada en las efemérides del operador, y justifica el uso de SupGP (ver [03-decisiones-fuentes-datos.md](03-decisiones-fuentes-datos.md)). CelesTrak limita SupGP a **una descarga cada 2 h por IP**. Durante el desarrollo esa cuota ya estaba consumida, así que el script guarda la descarga en `docs/data/` para poder re-ejecutarlo. Los valores se completan en [`resultados-validacion.md`](resultados-validacion.md) al correr `npm run validate`.

### Experimento 4 — Validación cruzada con N2YO (ISS, Hubble, NOAA 19, GPS, GOES 16)

Requiere una API key gratuita de N2YO (`N2YO_API_KEY=xxxx npm run validate`). Cubre las cinco clases de órbita, incluido el error de apuntamiento az/el. Ver [`resultados-validacion.md`](resultados-validacion.md).

## 3. Análisis

1. **La implementación es correcta.** Frente a una implementación independiente que usa el mismo set de elementos, la diferencia es de **2–3 metros** en la ventana de interés (±1 día alrededor de la época). Eso es ruido numérico. Cualquier error conceptual (TEME vs. ECEF, GMST, grados/radianes, UTC/local, geodésica vs. geocéntrica) produciría errores de 10 a 10 000 km.

2. **OMM vs. TLE: precisión del formato.** La única diferencia que crece está a −48 h, lejos de la época (107 m). Ambas fuentes usan el mismo set, pero nosotros leemos el **OMM**, con más decimales (B\* = `0.0001274916` vs. `12749-3` en TLE; movimiento medio con 8 vs. 8+ decimales). Esa diferencia mínima en los elementos se amplifica al propagar lejos de la época. Esto confirma empíricamente la recomendación del enunciado de usar OMM como formato principal: además de soportar NORAD de 6 dígitos, preserva la precisión del ajuste.

3. **Error real de SGP4.** La literatura (Vallado *et al.* 2006; estudios de CelesTrak con efemérides de operadores) reporta para elementos GP en LEO un error de ~1 km en la época, que crece ~1–3 km por día, dominado por el arrastre atmosférico. El Experimento 3 mide esta magnitud directamente para Starlink.

4. **Implicancias para las funciones de la app.**
   - **Mapa:** con errores de algunos km, la posición en un mapa mundial es exacta a la escala visible.
   - **Pases:** un error de 2 km a lo largo de la órbita equivale a ~0,3 s de adelanto/atraso del AOS (v ≈ 7,6 km/s). Es despreciable frente a la precisión de 1 s del algoritmo.
   - **Apuntamiento:** a 1000 km de rango, 2 km de error son ~0,1°, muy por debajo del error de la brújula del teléfono (5–15°) y del ancho de haz de una antena Yagi de aficionado (~30°).
   - **Antigüedad:** con TLE de más de 3 días, el error en LEO puede llegar a decenas de km y los AOS se desplazan varios segundos. Por eso la app muestra la antigüedad (verde < 1 día, ámbar 1–3 días, rojo > 3 días) y la caché se renueva cada 12 h (RF-09, RF-16).

## 4. Conclusiones

- El cálculo orbital de la app **reproduce las posiciones de referencia con errores de metros** (2 m típicos, 107 m máximo a 48 h de la época). Esto valida toda la cadena SGP4 → TEME → ECEF → WGS-84 → topocéntricas.
- El error absoluto respecto de la posición real está dominado por la **calidad y antigüedad del dato orbital**, no por la implementación. Las decisiones de diseño que lo controlan son: TTL de 12 h, OMM como formato principal, SupGP para Starlink y alerta de antigüedad.
- La validación es **reproducible** (`npm run validate`) y **visible en la app** (pantalla "Validación", con historial, estadísticas y exportación a CSV).

## 5. Cómo reproducir

```bash
cd app
npm run validate                         # Experimentos 1-3 (sin credenciales)
N2YO_API_KEY=tu_key npm run validate     # + Experimento 4
```

En la app: **Mapa → Validar** (o Ajustes → Validación) → *Comparar ahora*. Con la ISS seleccionada también está disponible *Serie ±12 h*.
