/**
 * Space-Track.org — catálogo oficial (18th Space Defense Squadron). Requiere
 * cuenta, por eso NO se llama desde la app: se consulta a través del proxy
 * propio (/server), que guarda usuario/contraseña, mantiene la cookie de
 * sesión y cachea. Aun así se aplica acá el límite oficial
 * (< 30 req/min y < 300 req/h) para no castigar la cuota compartida.
 */
import type { CatalogGroup, OrbitalRecord } from '../../types';
import { ProviderError } from '../errors';
import { requestJson, type HttpContext } from '../http';
import { isOmmLike, recordFromOmm } from '../omm';
import { RateLimiter } from '../rateLimiter';
import { BaseProvider, type ProxyConfig } from './DataProvider';

/** Grupos que el proxy sabe traducir a consultas Space-Track (ver server/src/index.ts). */
const SPACETRACK_GROUPS: CatalogGroup[] = ['stations', 'starlink', 'gps', 'weather', 'geo'];

export class SpaceTrackProvider extends BaseProvider {
  readonly id = 'spacetrack' as const;
  readonly label = 'Space-Track (vía proxy)';
  readonly limiter = new RateLimiter({ windows: [{ limit: 25, windowMs: 60_000 }, { limit: 280, windowMs: 3_600_000 }] });

  constructor(http: HttpContext, private readonly proxy: ProxyConfig) {
    super(http);
  }

  private get configured() {
    return !!this.proxy.baseUrl;
  }

  override supportsCatalog(group: CatalogGroup): boolean {
    return this.configured && SPACETRACK_GROUPS.includes(group);
  }
  override supportsOrbital(): boolean {
    return this.configured;
  }

  private async fetchOmm(op: string, path: string, dataset: string): Promise<OrbitalRecord[]> {
    if (!this.proxy.baseUrl) throw new ProviderError(this.id, 'not-configured', 'proxy no configurado');
    const data = await requestJson<unknown>(this.http, this.limiter, this.id, op, `${this.proxy.baseUrl}${path}`, {
      headers: this.proxy.token ? { 'x-app-token': this.proxy.token } : undefined,
    });
    if (!Array.isArray(data)) throw new ProviderError(this.id, 'invalid-data', 'se esperaba un arreglo OMM');
    const fetchedAt = this.now();
    return data.filter(isOmmLike).map((o) => recordFromOmm(o, this.id, fetchedAt, dataset));
  }

  override async getCatalog(group: CatalogGroup): Promise<OrbitalRecord[]> {
    const recs = await this.fetchOmm('catalog', `/spacetrack/group/${group}`, 'spacetrack-gp');
    if (recs.length === 0) throw new ProviderError(this.id, 'not-found', `grupo ${group} vacío`);
    return recs;
  }

  override async getOrbitalData(noradId: number): Promise<OrbitalRecord> {
    const recs = await this.fetchOmm('orbital', `/spacetrack/gp/${noradId}`, 'spacetrack-gp');
    const rec = recs.find((r) => r.noradId === noradId);
    if (!rec) throw new ProviderError(this.id, 'not-found', `NORAD ${noradId} no encontrado`);
    return rec;
  }
}
