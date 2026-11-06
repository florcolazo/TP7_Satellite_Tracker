import type { OMMJsonObject } from 'satellite.js';
import { SatelliteModel } from '../orbital/engine';
import type { OrbitalRecord } from '../types';
import fixtures from './fixtures/omm.json';

export type FixtureKey = 'iss' | 'gps' | 'goes16' | 'noaa19' | 'molniya' | 'starlink6';

export function recordFromOmm(omm: OMMJsonObject): OrbitalRecord {
  return {
    noradId: Number(omm.NORAD_CAT_ID),
    name: omm.OBJECT_NAME,
    objectId: omm.OBJECT_ID,
    elements: { format: 'omm', omm },
    epoch: Date.parse(omm.EPOCH + 'Z'),
    source: 'celestrak',
    fetchedAt: Date.parse(omm.EPOCH + 'Z'),
  };
}

export function fixtureRecord(key: FixtureKey): OrbitalRecord {
  return recordFromOmm((fixtures as Record<string, unknown>)[key] as OMMJsonObject);
}

export function fixtureModel(key: FixtureKey): SatelliteModel {
  return new SatelliteModel(fixtureRecord(key));
}

export function starlinkSample(): OrbitalRecord[] {
  return (fixtures.starlinkSample as unknown as OMMJsonObject[]).map(recordFromOmm);
}

/** Observador de referencia: FCyT-UADER, Concepción del Uruguay (Entre Ríos). */
export const CDU = { latitude: -32.4846, longitude: -58.2321, altitudeKm: 0.025 };
