import type { ProviderId } from '../types';

export type ProviderErrorKind =
  | 'network' // sin conexión, DNS, timeout
  | 'http' // status HTTP no exitoso
  | 'rate-limited' // límite propio o 429 del servidor
  | 'not-modified' // CelesTrak: "data has not updated since your last download"
  | 'not-found' // el proveedor no tiene ese objeto/grupo
  | 'not-supported' // el proveedor no implementa esa operación
  | 'not-configured' // falta proxy/credenciales
  | 'invalid-data' // respuesta no parseable
  | 'circuit-open'; // proveedor en cuarentena por fallas repetidas

export class ProviderError extends Error {
  constructor(
    readonly provider: ProviderId,
    readonly kind: ProviderErrorKind,
    message: string,
    readonly status?: number,
    /** Sugerencia del servidor (Retry-After) en ms. */
    readonly retryAfterMs?: number,
  ) {
    super(`[${provider}] ${message}`);
    this.name = 'ProviderError';
  }

  /** ¿Tiene sentido reintentar contra el MISMO proveedor? */
  get retryable(): boolean {
    if (this.kind === 'network') return true;
    if (this.kind === 'http') return this.status === undefined || this.status >= 500 || this.status === 408;
    if (this.kind === 'rate-limited') return this.status === 429; // 429 del servidor: backoff
    return false;
  }
}

/** Todos los proveedores fallaron: agrega los errores individuales. */
export class AllProvidersFailedError extends Error {
  constructor(readonly operation: string, readonly errors: ProviderError[]) {
    super(`${operation}: ningún proveedor respondió (${errors.map((e) => `${e.provider}: ${e.kind}`).join(', ')})`);
    this.name = 'AllProvidersFailedError';
  }
}
