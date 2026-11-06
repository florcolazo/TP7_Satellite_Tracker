/**
 * Cliente HTTP común a todos los proveedores: timeout, rate limiting,
 * reintentos con backoff y registro de cada intento (para la pantalla de
 * estado y para el informe de uso de APIs).
 */
import type { ProviderId } from '../types';
import { ProviderError } from './errors';
import { RateLimiter, RateLimitExceededError } from './rateLimiter';
import { DEFAULT_RETRY, withRetry, type RetryOptions } from './retry';

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

export interface RequestLogEntry {
  id: number;
  provider: ProviderId;
  operation: string;
  url: string;
  startedAt: number;
  durationMs: number;
  attempt: number;
  status?: number;
  ok: boolean;
  error?: string;
}

export interface HttpContext {
  fetch: Fetcher;
  timeoutMs?: number;
  retry?: RetryOptions;
  /** Espera máxima tolerada por el rate limiter antes de fallar (y hacer fallback). */
  maxRateWaitMs?: number;
  onLog?: (entry: RequestLogEntry) => void;
  now?: () => number;
}

let logSeq = 0;

/** Quita parámetros sensibles de una URL antes de loguearla. */
export function sanitizeUrl(url: string): string {
  return url.replace(/([?&](?:apiKey|apikey|password|token)=)[^&]*/gi, '$1***');
}

function parseRetryAfter(header: string | null, now: number): number | undefined {
  if (!header) return undefined;
  const secs = Number(header);
  if (Number.isFinite(secs)) return secs * 1000;
  const date = Date.parse(header);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}

export async function requestText(
  ctx: HttpContext,
  limiter: RateLimiter,
  provider: ProviderId,
  operation: string,
  url: string,
  init?: RequestInit,
): Promise<string> {
  const now = ctx.now ?? Date.now;
  return withRetry(async (attempt) => {
    try {
      await limiter.acquire(ctx.maxRateWaitMs ?? 10_000);
    } catch (e) {
      if (e instanceof RateLimitExceededError) {
        throw new ProviderError(provider, 'rate-limited', `límite local de requests (esperar ${Math.ceil(e.waitMs / 1000)} s)`);
      }
      throw e;
    }

    const startedAt = now();
    const log = (partial: Pick<RequestLogEntry, 'ok'> & Partial<RequestLogEntry>) =>
      ctx.onLog?.({ id: ++logSeq, provider, operation, url: sanitizeUrl(url), startedAt, durationMs: now() - startedAt, attempt, ...partial });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ctx.timeoutMs ?? 20_000);
    let res: Response;
    try {
      res = await ctx.fetch(url, { ...init, signal: controller.signal });
    } catch (e) {
      const msg = controller.signal.aborted ? 'timeout' : e instanceof Error ? e.message : String(e);
      log({ ok: false, error: msg });
      throw new ProviderError(provider, 'network', msg);
    } finally {
      clearTimeout(timer);
    }

    if (res.status === 429) {
      log({ ok: false, status: 429, error: 'HTTP 429' });
      throw new ProviderError(provider, 'rate-limited', 'HTTP 429 Too Many Requests', 429, parseRetryAfter(res.headers.get('retry-after'), now()));
    }
    if (!res.ok) {
      log({ ok: false, status: res.status, error: `HTTP ${res.status}` });
      throw new ProviderError(provider, res.status === 404 ? 'not-found' : 'http', `HTTP ${res.status}`, res.status);
    }
    const text = await res.text();
    log({ ok: true, status: res.status });
    return text;
  }, ctx.retry ?? DEFAULT_RETRY);
}

export async function requestJson<T>(
  ctx: HttpContext,
  limiter: RateLimiter,
  provider: ProviderId,
  operation: string,
  url: string,
  init?: RequestInit,
): Promise<T> {
  const text = await requestText(ctx, limiter, provider, operation, url, init);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ProviderError(provider, 'invalid-data', `respuesta no JSON: "${text.slice(0, 80)}"`);
  }
}
