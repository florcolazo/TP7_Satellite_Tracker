/**
 * Validation Layer (RF-15): compara la posición calculada localmente con la
 * que informa una fuente independiente, EN EL MISMO INSTANTE (el timestamp
 * de la fuente), para que la latencia de red no contamine el error.
 *
 * Métricas:
 *   - error horizontal: distancia de gran círculo entre puntos subsatelitales
 *   - error de altitud: diferencia de alturas
 *   - error 3D: distancia euclídea entre ambas posiciones en ECEF (WGS-84);
 *     es la métrica "honesta" para un enlace (error en el vector al satélite)
 *   - error de apuntamiento az/el, si la fuente lo informa (N2YO)
 */
import * as sat from 'satellite.js';
import { DEG2RAD, normalizeLon, type ObserverGeodetic, type SatelliteModel } from '../orbital/engine';
import type { GeoPosition, LatLng, ProviderId, ValidationPosition } from '../types';

/** Radio medio terrestre IUGG (km), adecuado para haversine. */
const MEAN_EARTH_RADIUS_KM = 6371.0088;

export function haversineKm(a: LatLng, b: LatLng): number {
  const φ1 = a.latitude * DEG2RAD;
  const φ2 = b.latitude * DEG2RAD;
  const dφ = φ2 - φ1;
  const dλ = normalizeLon(b.longitude - a.longitude) * DEG2RAD;
  const h = Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2;
  return 2 * MEAN_EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function ecefKm(p: LatLng & { altitudeKm: number }) {
  return sat.geodeticToEcf({ latitude: p.latitude * DEG2RAD, longitude: p.longitude * DEG2RAD, height: p.altitudeKm });
}

export function distance3dKm(a: LatLng & { altitudeKm: number }, b: LatLng & { altitudeKm: number }): number {
  const pa = ecefKm(a);
  const pb = ecefKm(b);
  return Math.hypot(pa.x - pb.x, pa.y - pb.y, pa.z - pb.z);
}

export interface ValidationSample {
  provider: ProviderId;
  noradId: number;
  timestamp: number;
  ours: GeoPosition;
  theirs: ValidationPosition;
  groundErrorKm: number;
  altitudeErrorKm: number;
  totalErrorKm: number;
  /** Antigüedad de NUESTROS elementos orbitales en ese instante (h). */
  dataAgeHours: number;
  azimuthErrorDeg?: number;
  elevationErrorDeg?: number;
}

export function compareWithReference(
  model: SatelliteModel,
  theirs: ValidationPosition,
  observer?: ObserverGeodetic,
): ValidationSample | null {
  const ours = model.position(theirs.timestamp);
  if (!ours) return null;
  const sample: ValidationSample = {
    provider: theirs.source,
    noradId: theirs.noradId,
    timestamp: theirs.timestamp,
    ours,
    theirs,
    groundErrorKm: haversineKm(ours, theirs),
    altitudeErrorKm: ours.altitudeKm - theirs.altitudeKm,
    totalErrorKm: distance3dKm(ours, theirs),
    dataAgeHours: model.dataAgeHours(theirs.timestamp),
  };
  if (observer && theirs.azimuth !== undefined && theirs.elevation !== undefined) {
    const la = model.look(observer, theirs.timestamp);
    if (la) {
      const dAz = Math.abs(la.azimuth - theirs.azimuth) % 360;
      sample.azimuthErrorDeg = dAz > 180 ? 360 - dAz : dAz;
      sample.elevationErrorDeg = Math.abs(la.elevation - theirs.elevation);
    }
  }
  return sample;
}

export interface ErrorStats {
  count: number;
  meanKm: number;
  rmsKm: number;
  maxKm: number;
  minKm: number;
}

export function errorStats(samples: Pick<ValidationSample, 'totalErrorKm'>[]): ErrorStats {
  if (samples.length === 0) return { count: 0, meanKm: 0, rmsKm: 0, maxKm: 0, minKm: 0 };
  const e = samples.map((s) => s.totalErrorKm);
  return {
    count: e.length,
    meanKm: e.reduce((a, b) => a + b, 0) / e.length,
    rmsKm: Math.sqrt(e.reduce((a, b) => a + b * b, 0) / e.length),
    maxKm: Math.max(...e),
    minKm: Math.min(...e),
  };
}
