/**
 * Reintentos con backoff exponencial + jitter ("full jitter", AWS Architecture
 * Blog). Respeta Retry-After cuando el servidor lo envía.
 *
 *   espera_n = random(0, min(maxDelay, base · 2ⁿ))
 */
import { ProviderError } from './errors';

export interface RetryOptions {
  retries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  onRetry?: (attempt: number, delayMs: number, error: unknown) => void;
}

export const DEFAULT_RETRY: RetryOptions = { retries: 2, baseDelayMs: 800, maxDelayMs: 8_000 };

export function backoffDelay(attempt: number, opts: RetryOptions, error?: unknown): number {
  const random = opts.random ?? Math.random;
  const cap = Math.min(opts.maxDelayMs, opts.baseDelayMs * 2 ** attempt);
  const jittered = Math.round(random() * cap);
  const retryAfter = error instanceof ProviderError ? error.retryAfterMs : undefined;
  return retryAfter !== undefined ? Math.max(retryAfter, jittered) : jittered;
}

export async function withRetry<T>(fn: (attempt: number) => Promise<T>, opts: RetryOptions = DEFAULT_RETRY): Promise<T> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  let attempt = 0;
  for (;;) {
    try {
      return await fn(attempt);
    } catch (error) {
      const retryable = error instanceof ProviderError ? error.retryable : false;
      if (!retryable || attempt >= opts.retries) throw error;
      const delay = backoffDelay(attempt, opts, error);
      opts.onRetry?.(attempt + 1, delay, error);
      await sleep(delay);
      attempt++;
    }
  }
}
