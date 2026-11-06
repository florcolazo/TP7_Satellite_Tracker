/**
 * N2YO — validación cruzada (RF-15) y fuente de TLE de último recurso.
 * La API key vive en el proxy; la app nunca la ve.
 *
 * Límites oficiales: 1000 transacciones/h para tle y positions,
 * 100/h para visualpasses, radiopasses y above. Se usan dos limiters.
 */
import type { Observer, OrbitalRecord, ValidationPosition } from '../../types';
import { ProviderError } from '../errors';
import { requestJson, type HttpContext } from '../http';
import { recordFromTle } from '../omm';
import { RateLimiter } from '../rateLimiter';
import { BaseProvider, type ProxyConfig } from './DataProvider';

interface N2yoTleResponse {
  info: { satid: number; satname: string };
  tle: string;
}

interface N2yoPositionsResponse {
  info: { satid: number; satname: string };
  positions: {
    satlatitude: number;
    satlongitude: number;
    sataltitude: number;
    azimuth: number;
    elevation: number;
    timestamp: number;
  }[];
}

export interface N2yoPass {
  startUTC: number;
  startAz: number;
  maxUTC: number;
  maxAz: number;
  maxEl: number;
  endUTC: number;
  endAz: number;
}

export class N2yoProvider extends BaseProvider {
  readonly id = 'n2yo' as const;
  readonly label = 'N2YO (vía proxy)';
  readonly limiter = new RateLimiter({ windows: [{ limit: 950, windowMs: 3_600_000 }], minIntervalMs: 250 });
  readonly passesLimiter = new RateLimiter({ windows: [{ limit: 95, windowMs: 3_600_000 }] });

  constructor(http: HttpContext, private readonly proxy: ProxyConfig) {
    super(http);
  }

  private get configured() {
    return !!this.proxy.baseUrl;
  }

  override supportsOrbital(): boolean {
    return this.configured;
  }
  override supportsValidation(): boolean {
    return this.configured;
  }

  private url(path: string) {
    if (!this.proxy.baseUrl) throw new ProviderError(this.id, 'not-configured', 'proxy no configurado');
    return `${this.proxy.baseUrl}/n2yo${path}`;
  }

  private get init(): RequestInit | undefined {
    return this.proxy.token ? { headers: { 'x-app-token': this.proxy.token } } : undefined;
  }

  override async getOrbitalData(noradId: number): Promise<OrbitalRecord> {
    const r = await requestJson<N2yoTleResponse>(this.http, this.limiter, this.id, 'orbital', this.url(`/tle/${noradId}`), this.init);
    const [l1, l2] = (r.tle ?? '').split(/\r?\n/);
    if (!l1 || !l2) throw new ProviderError(this.id, 'not-found', `sin TLE para ${noradId}`);
    return recordFromTle(r.info.satname, l1, l2, this.id, this.now());
  }

  override async getValidationPosition(noradId: number, o: Observer): Promise<ValidationPosition> {
    const q = `/positions/${noradId}/${o.latitude}/${o.longitude}/${Math.round(o.altitudeKm * 1000)}/1`;
    const r = await requestJson<N2yoPositionsResponse>(this.http, this.limiter, this.id, 'validation', this.url(q), this.init);
    const p = r.positions?.[0];
    if (!p) throw new ProviderError(this.id, 'not-found', `sin posición para ${noradId}`);
    return {
      source: this.id,
      noradId,
      latitude: p.satlatitude,
      longitude: p.satlongitude,
      altitudeKm: p.sataltitude,
      azimuth: p.azimuth,
      elevation: p.elevation,
      timestamp: p.timestamp * 1000,
    };
  }

  /** Pases de radio de N2YO: permiten contrastar también el predictor (no sólo la posición). */
  async getRadioPasses(noradId: number, o: Observer, days: number, minElevation: number): Promise<N2yoPass[]> {
    const q = `/radiopasses/${noradId}/${o.latitude}/${o.longitude}/${Math.round(o.altitudeKm * 1000)}/${days}/${Math.round(minElevation)}`;
    const r = await requestJson<{ passes?: N2yoPass[] }>(this.http, this.passesLimiter, this.id, 'radiopasses', this.url(q), this.init);
    return r.passes ?? [];
  }
}
