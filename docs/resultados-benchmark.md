# Resultados de benchmark

_Generado por `app/scripts/bench.ts` el 2026-11-06T17:49:33.698Z · Node v24.21.0 (V8)._

## Predicción de pases: refinamiento adaptativo vs. búsqueda ingenua

Ventana de 72 h, elevación mínima 10°, observador FCyT-UADER. "Exactitud" = máxima diferencia de AOS/LOS contra la búsqueda ingenua a paso de 1 s.

| Satélite | Clase | Pases | Evaluaciones (adaptativo) | Evaluaciones (ingenuo 1 s) | Reducción | Tiempo adaptativo | Tiempo ingenuo | Exactitud AOS/LOS |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| ISS (ZARYA) | LEO | 10 | 4.852 | 259.201 | ×53 | 21.2 ms | 561 ms | 1.2 s |
| NOAA 19 | LEO | 10 | 3.756 | 259.201 | ×69 | 13.7 ms | 571 ms | 1.2 s |
| STARLINK-38128 | LEO | 7 | 3.767 | 259.201 | ×69 | 10.5 ms | 525 ms | 1.0 s |
| NAVSTAR 81 (USA 319) | MEO | 6 | 1.135 | 259.201 | ×228 | 7.2 ms | 637 ms | 1.1 s |
| MOLNIYA 2-9 | HEO | 4 | 4.059 | 259.201 | ×64 | 12.1 ms | 750 ms | 0.9 s |
| GOES 16 | GEO | 1 | 284 | 259.201 | ×913 | 2.5 ms | 857 ms | 0.0 s |

## Capa de constelación: propagación en lote

Catálogo Starlink disponible: 11.206 satélites.

| Satélites | Propagación (ms) | µs por satélite | Clusters (vista mundial) | Agrupamiento (ms) |
|---:|---:|---:|---:|---:|
| 100 | 0.85 | 8.5 | 33 | 0.10 |
| 300 | 3.41 | 11.4 | 40 | 0.23 |
| 1.000 | 3.95 | 3.9 | 40 | 0.25 |
| 3.000 | 13.65 | 4.6 | 46 | 0.93 |
| 11.206 | 54.81 | 4.9 | 58 | 3.15 |

## Geometría del mapa

- Ground track ISS (½ órbita pasada + 1,05 órbitas futuras, paso 37 s): 241 puntos en 1.35 ms (se recalcula 1 vez por minuto).
- Footprint (120 vértices + recorte antimeridiano/polo): 0.098 ms (se recalcula cada 2 s).
- Una propagación SGP4 individual: 4.22 µs.
