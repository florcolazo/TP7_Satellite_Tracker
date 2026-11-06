/**
 * CelesTrak — fuente principal. Sin API key.
 *
 * Particularidades reales de la API que este proveedor maneja:
 *  - Responde HTTP 200 con TEXTO PLANO (no JSON) cuando:
 *      · se repite la misma descarga antes de que CelesTrak actualice sus datos:
 *        "GP data has not updated since your last successful download…"
 *        (en SupGP: "Please limit requests to once every 2 hours")
 *      · la consulta es inválida: "Invalid query: …"
 *      · no hay resultados: "No GP data found"
 *    → se traducen a errores tipados (not-modified / not-found) para que el
 *      orquestador use la caché o el siguiente proveedor.
 *  - Abusar de la API provoca bloqueo de IP: por eso el TTL mínimo de caché es
 *    de 2 h y el limiter es conservador.
 */
import type { CatalogGroup, OrbitalRecord } from '../../types';
import { ProviderError } from '../errors';
import { groupDef } from '../groups';
import { requestText } from '../http';
import { isOmmLike, recordFromOmm } from '../omm';
import { RateLimiter } from '../rateLimiter';
import { BaseProvider, type CatalogContext } from './DataProvider';

const BASE = 'https://celestrak.org/NORAD/elements';

export class CelesTrakProvider extends BaseProvider {
  readonly id = 'celestrak' as const;
  readonly label = 'CelesTrak';
  readonly limiter = new RateLimiter({ windows: [{ limit: 20, windowMs: 60_000 }, { limit: 200, windowMs: 3_600_000 }] });

  override supportsCatalog(): boolean {
    return true;
  }
  override supportsOrbital(): boolean {
    return true;
  }
  override supportsSearch(): boolean {
    return true;
  }

  /** Interpreta la respuesta: JSON OMM o uno de los mensajes de texto conocidos. */
  private parse(text: string, dataset?: string): OrbitalRecord[] {
    const trimmed = text.trim();
    if (!trimmed.startsWith('[')) {
      if (/has not updated|limit requests/i.test(trimmed)) {
        throw new ProviderError(this.id, 'not-modified', 'sin cambios desde la última descarga (usar caché)');
      }
      if (/no gp data found|not found/i.test(trimmed)) throw new ProviderError(this.id, 'not-found', trimmed.slice(0, 100));
      throw new ProviderError(this.id, 'invalid-data', trimmed.slice(0, 100) || 'respuesta vacía');
    }
    let data: unknown;
    try {
      data = JSON.parse(trimmed);
    } catch {
      throw new ProviderError(this.id, 'invalid-data', 'JSON inválido');
    }
    if (!Array.isArray(data)) throw new ProviderError(this.id, 'invalid-data', 'se esperaba un arreglo OMM');
    const fetchedAt = this.now();
    return data.filter(isOmmLike).map((o) => recordFromOmm(o, this.id, fetchedAt, dataset));
  }

  private async get(op: string, url: string, dataset?: string) {
    const text = await requestText(this.http, this.limiter, this.id, op, url);
    return this.parse(text, dataset);
  }

  override async getCatalog(group: CatalogGroup, ctx?: CatalogContext): Promise<OrbitalRecord[]> {
    const def = groupDef(group);
    if (def.celestrakSupGp) {
      // Starlink: preferimos SupGP (derivado de las efemérides que publica SpaceX,
      // más preciso que el GP generado por radar) y caemos al GP estándar.
      try {
        const sup = await this.get('catalog:supgp', `${BASE}/supplemental/sup-gp.php?FILE=${def.celestrakSupGp}&FORMAT=json`, 'supgp');
        if (sup.length > 0) return sup;
      } catch (e) {
        if (!(e instanceof ProviderError) || e.kind === 'rate-limited') throw e;
        // "not-modified" + caché local: la caché SupGP es la mejor fuente; no degradar a GP.
        if (e.kind === 'not-modified' && ctx?.hasCache) throw e;
      }
    }
    const recs = await this.get('catalog', `${BASE}/gp.php?GROUP=${encodeURIComponent(def.celestrakGroup)}&FORMAT=json`, 'gp');
    if (recs.length === 0) throw new ProviderError(this.id, 'not-found', `grupo ${group} vacío`);
    return recs;
  }

  override async getOrbitalData(noradId: number): Promise<OrbitalRecord> {
    const recs = await this.get('orbital', `${BASE}/gp.php?CATNR=${noradId}&FORMAT=json`, 'gp');
    const rec = recs.find((r) => r.noradId === noradId);
    if (!rec) throw new ProviderError(this.id, 'not-found', `NORAD ${noradId} no encontrado`);
    return rec;
  }

  override async searchByName(query: string): Promise<OrbitalRecord[]> {
    try {
      return await this.get('search', `${BASE}/gp.php?NAME=${encodeURIComponent(query)}&FORMAT=json`, 'gp');
    } catch (e) {
      if (e instanceof ProviderError && e.kind === 'not-found') return [];
      throw e;
    }
  }
}
