/**
 * Where the ISS at? — sin autenticación, sólo la ISS (NORAD 25544).
 * Límite publicado en headers: X-Rate-Limit-Limit 350 / 5 min; además la
 * documentación pide ~1 request/s.
 */
import type { Observer, OrbitalRecord, ValidationPosition } from '../../types';
import { requestJson } from '../http';
import { recordFromTle } from '../omm';
import { RateLimiter } from '../rateLimiter';
import { BaseProvider } from './DataProvider';

export const ISS_NORAD_ID = 25544;
const BASE = 'https://api.wheretheiss.at/v1/satellites/25544';

interface WtiaPosition {
  latitude: number;
  longitude: number;
  altitude: number;
  velocity: number;
  visibility: string;
  footprint: number;
  timestamp: number;
}

export class WhereTheIssProvider extends BaseProvider {
  readonly id = 'wheretheiss' as const;
  readonly label = 'Where the ISS at?';
  readonly limiter = new RateLimiter({ windows: [{ limit: 300, windowMs: 5 * 60_000 }], minIntervalMs: 1100 });

  override supportsOrbital(noradId: number): boolean {
    return noradId === ISS_NORAD_ID;
  }
  override supportsValidation(noradId: number): boolean {
    return noradId === ISS_NORAD_ID;
  }

  override async getOrbitalData(): Promise<OrbitalRecord> {
    const r = await requestJson<{ header: string; line1: string; line2: string }>(
      this.http, this.limiter, this.id, 'orbital', `${BASE}/tles?format=json`,
    );
    return recordFromTle(r.header || 'ISS (ZARYA)', r.line1, r.line2, this.id, this.now());
  }

  private toValidation(p: WtiaPosition): ValidationPosition {
    return {
      source: this.id,
      noradId: ISS_NORAD_ID,
      latitude: p.latitude,
      longitude: p.longitude,
      altitudeKm: p.altitude,
      timestamp: p.timestamp * 1000,
    };
  }

  override async getValidationPosition(_noradId: number, _observer: Observer): Promise<ValidationPosition> {
    const p = await requestJson<WtiaPosition>(this.http, this.limiter, this.id, 'validation', `${BASE}?units=kilometers`);
    return this.toValidation(p);
  }

  /** Hasta 10 instantes por request: útil para medir error vs. tiempo (informe de validación). */
  async getPositionsAt(timestampsMs: number[]): Promise<ValidationPosition[]> {
    const ts = timestampsMs.slice(0, 10).map((t) => Math.round(t / 1000)).join(',');
    const arr = await requestJson<WtiaPosition[]>(
      this.http, this.limiter, this.id, 'validation', `${BASE}/positions?timestamps=${ts}&units=kilometers`,
    );
    return arr.map((p) => this.toValidation(p));
  }
}
