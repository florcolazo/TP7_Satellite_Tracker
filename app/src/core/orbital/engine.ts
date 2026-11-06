/**
 * Orbital Engine — wrapper tipado sobre satellite.js (SGP4/SDP4).
 *
 * satellite.js elige automáticamente SGP4 (órbitas "near-Earth", período < 225 min)
 * o SDP4 (deep space: MEO/GEO/HEO, con perturbaciones lunisolares) según el
 * movimiento medio del set de elementos.
 *
 * Pipeline de coordenadas:
 *   OMM/TLE ──json2satrec/twoline2satrec──▶ satrec
 *   satrec ──propagate(t)──▶ r,v en TEME (≈ ECI)  [km, km/s]
 *   ECI ──GMST(t)──▶ ECF (fijo a la Tierra)
 *   ECF ──WGS-84──▶ geodésicas (lat, lon, h)            → punto subsatelital
 *   ECF − ECF_obs ──rotación SEZ──▶ azimut/elevación/rango → topocéntricas
 */
import * as sat from 'satellite.js';
import type { EciVec3, SatRec } from 'satellite.js';
import type { GeoPosition, LookAngles, Observer, OrbitalElements, OrbitalRecord, OrbitClass } from '../types';

export const RAD2DEG = 180 / Math.PI;
export const DEG2RAD = Math.PI / 180;
/** Radio ecuatorial WGS-84 (km). */
export const EARTH_RADIUS_KM = 6378.137;
/** Parámetro gravitacional terrestre μ (km³/s²). */
export const EARTH_MU = 398600.4418;
/** Julian Date de la época Unix (1970-01-01T00:00Z). */
const JD_UNIX_EPOCH = 2440587.5;

export class OrbitalError extends Error {
  constructor(message: string, readonly code?: number) {
    super(message);
    this.name = 'OrbitalError';
  }
}

/** Normaliza un ángulo a [0, 360). */
export function normalizeDeg(deg: number): number {
  const r = deg % 360;
  return r < 0 ? r + 360 : r;
}

/** Normaliza una longitud a [-180, 180). */
export function normalizeLon(lon: number): number {
  return normalizeDeg(lon + 180) - 180;
}

export function createSatrec(elements: OrbitalElements): SatRec {
  const satrec =
    elements.format === 'omm'
      ? sat.json2satrec(elements.omm)
      : sat.twoline2satrec(elements.line1, elements.line2);
  if (satrec.error !== sat.SatRecError.None) {
    throw new OrbitalError(`Elementos orbitales inválidos (SatRecError ${satrec.error})`, satrec.error);
  }
  return satrec;
}

/** Época de los elementos (ms Unix) leída del satrec: sirve igual para OMM y TLE. */
export function satrecEpochMs(satrec: SatRec): number {
  const jdF = (satrec as SatRec & { jdsatepochF?: number }).jdsatepochF ?? 0;
  return (satrec.jdsatepoch + jdF - JD_UNIX_EPOCH) * 86_400_000;
}

/** Observador en el formato geodésico (radianes) que espera satellite.js. */
export interface ObserverGeodetic {
  longitude: number;
  latitude: number;
  height: number;
}

export function toObserverGeodetic(o: Observer): ObserverGeodetic {
  return { latitude: o.latitude * DEG2RAD, longitude: o.longitude * DEG2RAD, height: o.altitudeKm };
}

/** Estado inercial en un instante, reutilizable para varias conversiones sin re-propagar. */
export interface EciState {
  time: number;
  position: EciVec3<number>;
  velocity: EciVec3<number>;
  gmst: number;
}

export function propagateEci(satrec: SatRec, time: number): EciState | null {
  const date = new Date(time);
  const pv = sat.propagate(satrec, date);
  if (!pv) return null;
  return { time, position: pv.position, velocity: pv.velocity, gmst: sat.gstime(date) };
}

export function eciToGeoPosition(state: EciState): GeoPosition {
  const g = sat.eciToGeodetic(state.position, state.gmst);
  const v = state.velocity;
  return {
    latitude: g.latitude * RAD2DEG,
    longitude: normalizeLon(g.longitude * RAD2DEG),
    altitudeKm: g.height,
    velocityKmS: Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z),
    timestamp: state.time,
  };
}

export function eciToLookAngles(state: EciState, observer: ObserverGeodetic): LookAngles {
  const ecf = sat.eciToEcf(state.position, state.gmst);
  const la = sat.ecfToLookAngles(observer, ecf);
  return {
    azimuth: normalizeDeg(la.azimuth * RAD2DEG),
    elevation: la.elevation * RAD2DEG,
    rangeKm: la.rangeSat,
  };
}

export interface OrbitSummary {
  periodMin: number;
  /** Semieje mayor (km). */
  semiMajorAxisKm: number;
  perigeeKm: number;
  apogeeKm: number;
  inclinationDeg: number;
  eccentricity: number;
  orbitClass: OrbitClass;
}

/** Parámetros keplerianos medios derivados del set de elementos. */
export function summarizeOrbit(satrec: SatRec): OrbitSummary {
  const nRadPerMin = satrec.no; // movimiento medio (Kozai→Brouwer) en rad/min
  const periodMin = (2 * Math.PI) / nRadPerMin;
  const nRadPerSec = nRadPerMin / 60;
  const a = Math.cbrt(EARTH_MU / (nRadPerSec * nRadPerSec));
  const e = satrec.ecco;
  const perigeeKm = a * (1 - e) - EARTH_RADIUS_KM;
  const apogeeKm = a * (1 + e) - EARTH_RADIUS_KM;
  return {
    periodMin,
    semiMajorAxisKm: a,
    perigeeKm,
    apogeeKm,
    inclinationDeg: satrec.inclo * RAD2DEG,
    eccentricity: e,
    orbitClass: classifyOrbit(periodMin, e, apogeeKm),
  };
}

export function classifyOrbit(periodMin: number, eccentricity: number, apogeeKm: number): OrbitClass {
  if (eccentricity > 0.25) return 'HEO'; // Molniya, GTO, etc.
  if (apogeeKm < 2000) return 'LEO';
  if (periodMin > 1380 && periodMin < 1500) return 'GEO'; // geosincrónica (≈ 1436 min)
  return 'MEO';
}

/**
 * Modelo de un satélite listo para consultar. Encapsula el satrec y cachea el
 * resumen orbital; todas las consultas son puras respecto del tiempo dado.
 */
export class SatelliteModel {
  readonly satrec: SatRec;
  readonly orbit: OrbitSummary;
  readonly epoch: number;

  constructor(readonly record: OrbitalRecord) {
    this.satrec = createSatrec(record.elements);
    this.orbit = summarizeOrbit(this.satrec);
    this.epoch = satrecEpochMs(this.satrec);
  }

  get noradId() {
    return this.record.noradId;
  }

  get name() {
    return this.record.name;
  }

  state(time: number): EciState | null {
    return propagateEci(this.satrec, time);
  }

  position(time: number): GeoPosition | null {
    const s = this.state(time);
    return s ? eciToGeoPosition(s) : null;
  }

  look(observer: ObserverGeodetic, time: number): LookAngles | null {
    const s = this.state(time);
    return s ? eciToLookAngles(s, observer) : null;
  }

  /** Antigüedad de los elementos orbitales respecto de `now`, en horas (RF-16). */
  dataAgeHours(now: number): number {
    return (now - this.epoch) / 3_600_000;
  }
}
