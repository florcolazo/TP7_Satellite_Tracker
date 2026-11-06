# Guion del video demo (≈ 4 minutos)

El enunciado pide mostrar: selección de un satélite real (ISS), su posición en tiempo real con ground track y footprint, la capa Starlink, el próximo pase visible con sky chart y una notificación disparada. Este guion cubre todo eso y algo más.

## Preparación (antes de grabar)

1. Server corriendo (`cd server && npm start`) y la app abierta en Expo Go, en el teléfono, con internet.
2. Abrir una vez el catálogo **Starlink** antes de grabar, para que la descarga (~11 000 satélites) ya esté en caché.
3. Grabar la pantalla del teléfono (Android: grabador de pantalla del sistema; iOS: Centro de control). Para la parte de la brújula conviene filmar el teléfono con otra cámara.
4. Permisos de ubicación y notificaciones ya concedidos.

## Escenas

| # | Tiempo | Pantalla | Acción | Qué decir |
|---|---|---|---|---|
| 1 | 0:00 | Catálogo | Tocar **ISS (ZARYA)** en Destacados | "Elegimos un satélite real. Los elementos orbitales vienen de CelesTrak en formato OMM y quedan en caché en SQLite." |
| 2 | 0:15 | Mapa | Mostrar el marcador moviéndose y la tarjeta (lat/lon/alt/vel, az/el) | "La posición se calcula en el teléfono con SGP4, dos veces por segundo, sin consultar ninguna API." |
| 3 | 0:35 | Mapa | Alejar el zoom, mostrar el ground track cruzando el antimeridiano (Pacífico) | "Media órbita pasada punteada, una órbita futura en cian. En ±180° la línea se corta e interpola el cruce exacto." |
| 4 | 0:55 | Mapa | Chip **Footprint**; tocar el badge **TLE x h** | "Área de cobertura para la elevación mínima configurada, con su geometría. El badge indica la antigüedad de los datos orbitales." |
| 5 | 1:15 | Mapa | Chip **Constelación** → hacer zoom | "Capa Starlink: 300 satélites submuestreados de más de 11 000, propagados en lote cada 3 s y agrupados según el zoom." |
| 6 | 1:40 | Pases | Mostrar la lista, el ✨ de visible a simple vista y la línea verde de rendimiento | "Predicción de pases con paso adaptativo y refinamiento: unas 50 veces menos cálculos que la fuerza bruta, con precisión de 1 s." |
| 7 | 2:00 | Detalle de pase | Abrir el próximo pase visible | "Sky chart polar: AOS en verde, máximo, LOS en rojo; ámbar donde el satélite está iluminado. Abajo, Doppler y pérdida de espacio libre por banda." |
| 8 | 2:30 | Pases | **Probar aviso** → bloquear el teléfono → llega la notificación | "Notificación de pase. También se puede programar N minutos antes de cada pase o vigilar el satélite." |
| 9 | 2:50 | Brújula | Girar con el teléfono hasta que quede verde y vibre | "Modo brújula: rumbo verdadero e inclinación del teléfono para apuntar al satélite o a donde va a aparecer." |
| 10 | 3:15 | Validación | **Comparar ahora** y **Serie ±12 h** | "Validación contra Where the ISS at? y N2YO: el error es de pocos metros con el mismo set de elementos." |
| 11 | 3:40 | Ajustes → Proveedores | Mostrar el circuito, las cuotas y el log | "Capa de proveedores con caché, rate limiting por API, reintentos con backoff y fallback automático. Las credenciales quedan en el proxy." |
| 12 | 3:55 | — | Cierre | "Todo el núcleo está cubierto por 75 tests automáticos." |

**Tip:** si en el momento de grabar no hay ningún pase de la ISS cercano, para la escena 7 se puede elegir **NOAA 19** o **CSS (TIANHE)**, que suelen tener pases más frecuentes desde Concepción del Uruguay.
