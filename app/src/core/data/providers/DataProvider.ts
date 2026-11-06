/**
 * Interfaz común de proveedores (requisito 4.3). Cada proveedor declara qué
 * operaciones soporta; el orquestador (OrbitalRepository) sólo le pide lo que
 * puede responder y aplica fallback entre ellos.
 */
import type { CatalogGroup, Observer, OrbitalRecord, ProviderId, ValidationPosition } from '../../types';
import { ProviderError } from '../errors';
import type { HttpContext } from '../http';
import type { RateLimiter } from '../rateLimiter';

export interface CatalogContext {
  hasCache: boolean;
}

export interface DataProvider {
  readonly id: ProviderId;
  readonly label: string;
  readonly limiter: RateLimiter;

  supportsCatalog(group: CatalogGroup): boolean;
  supportsOrbital(noradId: number): boolean;
  supportsValidation(noradId: number): boolean;
  supportsSearch(): boolean;

  /**
   * @param ctx.hasCache el orquestador ya tiene una copia local de este grupo:
   *   ante "not-modified" el proveedor debe propagar el error (se usa la caché)
   *   en vez de buscar una fuente alternativa de menor calidad.
   */
  getCatalog(group: CatalogGroup, ctx?: CatalogContext): Promise<OrbitalRecord[]>;
  getOrbitalData(noradId: number): Promise<OrbitalRecord>;
  getValidationPosition(noradId: number, observer: Observer): Promise<ValidationPosition>;
  searchByName(query: string): Promise<OrbitalRecord[]>;
}

/** Proxy/backend propio que guarda credenciales (Space-Track, N2YO). */
export interface ProxyConfig {
  baseUrl?: string;
  /** Token de acceso al proxy (no es una credencial de terceros). */
  token?: string;
}

export abstract class BaseProvider implements DataProvider {
  abstract readonly id: ProviderId;
  abstract readonly label: string;
  abstract readonly limiter: RateLimiter;

  constructor(protected readonly http: HttpContext) {}

  supportsCatalog(_group: CatalogGroup): boolean {
    return false;
  }
  supportsOrbital(_noradId: number): boolean {
    return false;
  }
  supportsValidation(_noradId: number): boolean {
    return false;
  }
  supportsSearch(): boolean {
    return false;
  }

  protected unsupported(op: string): never {
    throw new ProviderError(this.id, 'not-supported', `${op} no soportado`);
  }

  async getCatalog(_group: CatalogGroup, _ctx?: CatalogContext): Promise<OrbitalRecord[]> {
    return this.unsupported('getCatalog');
  }
  async getOrbitalData(_noradId: number): Promise<OrbitalRecord> {
    return this.unsupported('getOrbitalData');
  }
  async getValidationPosition(_noradId: number, _observer: Observer): Promise<ValidationPosition> {
    return this.unsupported('getValidationPosition');
  }
  async searchByName(_query: string): Promise<OrbitalRecord[]> {
    return this.unsupported('searchByName');
  }

  protected now() {
    return (this.http.now ?? Date.now)();
  }
}
