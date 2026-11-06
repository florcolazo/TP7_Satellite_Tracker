/**
 * Tipos de dominio compartidos por todas las capas.
 *
 * Convenciones de unidades (salvo que el nombre diga otra cosa):
 *   - Ángulos en GRADOS en toda la API pública del dominio (radianes sólo
 *     dentro del motor orbital, al hablar con satellite.js).
 *   - Distancias en KILÓMETROS.
 *   - Tiempos como epoch en MILISEGUNDOS (number) o Date.
 */
import type { OMMJsonObject } from 'satellite.js';

export type ProviderId = 'celestrak' | 'spacetrack' | 'n2yo' | 'wheretheiss';

/** Datos orbitales tal como los entrega un proveedor (OMM/JSON preferido, TLE como respaldo). */
export type OrbitalElements =
  | { format: 'omm'; omm: OMMJsonObject }
  | { format: 'tle'; line1: string; line2: string };

/** Registro orbital normalizado: lo que guarda la caché y consume el motor. */
export interface OrbitalRecord {
  noradId: number;
  name: string;
  /** Designador internacional (COSPAR), si se conoce. */
  objectId?: string;
  elements: OrbitalElements;
  /** Época de los elementos orbitales (ms). Define la "antigüedad" del dato (RF-16). */
  epoch: number;
  /** Proveedor que lo entregó. */
  source: ProviderId;
  /** Momento en que lo descargamos (ms). Define el TTL de caché (RF-09). */
  fetchedAt: number;
  /** Conjunto de datos de origen (p. ej. 'supgp' = efemérides del operador vía CelesTrak). */
  dataset?: string;
}

export interface LatLng {
  latitude: number;
  longitude: number;
}

/** Ubicación del observador (estación terrena). */
export interface Observer extends LatLng {
  altitudeKm: number;
}

/** Punto subsatelital + altitud. */
export interface GeoPosition extends LatLng {
  altitudeKm: number;
  velocityKmS: number;
  timestamp: number;
}

/** Coordenadas topocéntricas respecto del observador. */
export interface LookAngles {
  azimuth: number; // 0 = Norte, 90 = Este
  elevation: number; // 0 = horizonte, 90 = cenit
  rangeKm: number;
}

export type OrbitClass = 'LEO' | 'MEO' | 'GEO' | 'HEO';

export interface SkySample extends LookAngles {
  time: number;
  /** Satélite iluminado por el Sol (no en la sombra terrestre). */
  sunlit: boolean;
}

export interface PassPoint {
  time: number;
  azimuth: number;
  elevation: number;
}

/** Ventana de visibilidad AOS → máximo → LOS (RF-04). */
export interface Pass {
  noradId: number;
  aos: PassPoint;
  max: PassPoint;
  los: PassPoint;
  durationSec: number;
  /**
   * Pase visible a simple vista: satélite iluminado mientras el observador
   * está en oscuridad (Sol < -6°, crepúsculo civil). Un pase no visible
   * sigue siendo un pase de RADIO válido para un enlace.
   */
  visual: boolean;
  /** El pase ya estaba en curso al inicio de la búsqueda (AOS recortado). */
  aosClipped: boolean;
  /** El pase sigue en curso al final de la ventana (LOS recortado). */
  losClipped: boolean;
  /** Trayectoria muestreada para el sky chart (RF-05). */
  samples: SkySample[];
}

/** Posición informada por una fuente independiente (RF-15). */
export interface ValidationPosition extends LatLng {
  source: ProviderId;
  noradId: number;
  altitudeKm: number;
  timestamp: number;
  azimuth?: number;
  elevation?: number;
}

/** Grupos del catálogo (RF-08). */
export type CatalogGroup =
  | 'stations'
  | 'starlink'
  | 'gps'
  | 'weather'
  | 'geo'
  | 'amateur'
  | 'visual'
  | 'science';
