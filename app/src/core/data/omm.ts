/** Normalización de OMM/TLE de distintas fuentes a `OrbitalRecord`. */
import * as sat from 'satellite.js';
import type { OMMJsonObject } from 'satellite.js';
import { satrecEpochMs } from '../orbital/engine';
import type { OrbitalRecord, ProviderId } from '../types';

/**
 * EPOCH de OMM: "2026-11-05T20:28:36.809184" (UTC, sin zona, microsegundos).
 * Se parsea a mano: algunos motores JS (Hermes incluido) no garantizan
 * Date.parse con 6 decimales ni sin sufijo de zona.
 */
export function parseOmmEpoch(epoch: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?/.exec(epoch.trim());
  if (!m) return NaN;
  const ms = m[7] ? Math.round(Number(`0.${m[7]}`) * 1000) : 0;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], ms);
}

/** Campos mínimos necesarios para propagar: descartamos el resto para ahorrar espacio. */
const OMM_KEEP = [
  'OBJECT_NAME', 'OBJECT_ID', 'EPOCH', 'MEAN_MOTION', 'ECCENTRICITY', 'INCLINATION', 'RA_OF_ASC_NODE',
  'ARG_OF_PERICENTER', 'MEAN_ANOMALY', 'EPHEMERIS_TYPE', 'CLASSIFICATION_TYPE', 'NORAD_CAT_ID',
  'ELEMENT_SET_NO', 'REV_AT_EPOCH', 'BSTAR', 'MEAN_MOTION_DOT', 'MEAN_MOTION_DDOT',
] as const;

export function slimOmm(raw: Record<string, unknown>): OMMJsonObject {
  const out: Record<string, unknown> = {};
  for (const k of OMM_KEEP) if (raw[k] !== undefined && raw[k] !== null) out[k] = raw[k];
  return out as unknown as OMMJsonObject;
}

export function isOmmLike(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && 'NORAD_CAT_ID' in x && 'MEAN_MOTION' in x && 'EPOCH' in x;
}

export function recordFromOmm(raw: Record<string, unknown>, source: ProviderId, fetchedAt: number, dataset?: string): OrbitalRecord {
  const omm = slimOmm(raw);
  return {
    noradId: Number(omm.NORAD_CAT_ID),
    name: String(omm.OBJECT_NAME ?? `NORAD ${omm.NORAD_CAT_ID}`).trim(),
    objectId: omm.OBJECT_ID ? String(omm.OBJECT_ID) : undefined,
    elements: { format: 'omm', omm },
    epoch: parseOmmEpoch(String(omm.EPOCH)),
    source,
    fetchedAt,
    dataset,
  };
}

export function recordFromTle(name: string, line1: string, line2: string, source: ProviderId, fetchedAt: number): OrbitalRecord {
  const satrec = sat.twoline2satrec(line1.trim(), line2.trim());
  return {
    noradId: Number(line1.substring(2, 7).trim()),
    name: name.trim(),
    elements: { format: 'tle', line1: line1.trim(), line2: line2.trim() },
    epoch: satrecEpochMs(satrec),
    source,
    fetchedAt,
  };
}
