# Resultados de validación

_Generado por `app/scripts/validate.ts` el 2026-11-06T17:48:12.558Z. Observador: FCyT-UADER (-32.4846, -58.2321)._

## Experimento 1 — ISS: SGP4 local vs. Where the ISS at? (serie temporal)

- Nuestros elementos: CelesTrak GP (OMM), época 2026-11-05T20:28:36.809Z
- Elementos de Where the ISS at?: TLE con época 2026-11-05T20:28:36.809Z (set distinto)
- Instante de ejecución: 2026-11-06T17:48:12.558Z

| Offset | Instante (UTC) | Antigüedad TLE | Error horizontal (km) | Error altitud (km) | Error 3D (km) |
|---:|---|---:|---:|---:|---:|
| -48 h | 2026-11-04T17:48:13Z | -26.7 h | 0.095 | 0.032 | 0.107 |
| -24 h | 2026-11-05T17:48:13Z | -2.7 h | 0.002 | -0.002 | 0.002 |
| -12 h | 2026-11-06T05:48:13Z | 9.3 h | 0.001 | -0.002 | 0.003 |
| -6 h | 2026-11-06T11:48:13Z | 15.3 h | 0.001 | -0.002 | 0.002 |
| -1 h | 2026-11-06T16:48:13Z | 20.3 h | 0.002 | -0.002 | 0.003 |
| +0 h | 2026-11-06T17:48:13Z | 21.3 h | 0.001 | -0.002 | 0.002 |
| +1 h | 2026-11-06T18:48:13Z | 22.3 h | 0.001 | -0.002 | 0.002 |
| +6 h | 2026-11-06T23:48:13Z | 27.3 h | 0.001 | -0.002 | 0.002 |
| +12 h | 2026-11-07T05:48:13Z | 33.3 h | 0.001 | -0.002 | 0.002 |
| +24 h | 2026-11-07T17:48:13Z | 45.3 h | 0.002 | -0.002 | 0.003 |

**Resumen:** n=10, error 3D medio 0.013 km, RMS 0.034 km, máximo 0.107 km.

## Experimento 2 — ISS en vivo: 10 muestras de la posición actual

| Instante (UTC) | Lat ref | Lon ref | Alt ref (km) | Error 3D (km) |
|---|---:|---:|---:|---:|
| 2026-11-06T17:48:24Z | -50.7288 | -72.7312 | 435.22 | 0.002 |
| 2026-11-06T17:48:25Z | -50.7151 | -72.6363 | 435.21 | 0.002 |
| 2026-11-06T17:48:26Z | -50.7013 | -72.5414 | 435.20 | 0.002 |
| 2026-11-06T17:48:28Z | -50.6735 | -72.3518 | 435.18 | 0.002 |
| 2026-11-06T17:48:29Z | -50.6595 | -72.2571 | 435.16 | 0.002 |
| 2026-11-06T17:48:30Z | -50.6454 | -72.1624 | 435.15 | 0.002 |
| 2026-11-06T17:48:31Z | -50.6312 | -72.0678 | 435.14 | 0.002 |
| 2026-11-06T17:48:32Z | -50.6170 | -71.9733 | 435.13 | 0.002 |
| 2026-11-06T17:48:33Z | -50.6026 | -71.8788 | 435.12 | 0.002 |
| 2026-11-06T17:48:34Z | -50.5882 | -71.7844 | 435.11 | 0.002 |

**Resumen:** error 3D medio 0.002 km (máx 0.002 km).

## Experimento 3 — Starlink: GP (radar, 18 SDS) vs. SupGP (efemérides del operador)

> No se pudo ejecutar: SupGP data has not updated since last successful FILE=starlink download at 2026-11-06 17:14:47 UTC Please limit requests to once every 2 hours
> (CelesTrak limita SupGP a una descarga cada 2 h por IP; reintentar más tarde.)

## Experimento 4 — Validación cruzada con N2YO

> Omitido: definir `N2YO_API_KEY` para ejecutarlo (`N2YO_API_KEY=xxxx npm run validate`).

