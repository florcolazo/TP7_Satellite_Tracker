/**
 * Rate limiter de ventana deslizante con múltiples ventanas simultáneas.
 *
 * Ejemplo Space-Track: { 30 / 60 s } y { 300 / 3600 s } a la vez.
 * Mantiene el log de timestamps de las requests concedidas y, si alguna
 * ventana está llena, calcula cuánto falta para que se libere un lugar.
 *
 * `acquire()` espera hasta `maxWaitMs`; si la espera sería mayor, falla
 * de inmediato para que el orquestador pase al siguiente proveedor en vez de
 * dejar al usuario mirando un spinner.
 */
export interface RateWindow {
  limit: number;
  windowMs: number;
}

export interface RateLimiterOptions {
  windows: RateWindow[];
  /** Separación mínima entre dos requests (p. ej. 1000 ms para Where the ISS at?). */
  minIntervalMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export class RateLimitExceededError extends Error {
  constructor(readonly waitMs: number) {
    super(`Límite de requests alcanzado; habría que esperar ${Math.ceil(waitMs / 1000)} s`);
    this.name = 'RateLimitExceededError';
  }
}

export class RateLimiter {
  private log: number[] = [];
  private readonly maxWindow: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  /** Cola para serializar `acquire` concurrentes y no conceder de más. */
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private readonly opts: RateLimiterOptions) {
    this.maxWindow = Math.max(...opts.windows.map((w) => w.windowMs), opts.minIntervalMs ?? 0);
    this.now = opts.now ?? Date.now;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  /** Milisegundos a esperar para poder emitir una request ahora (0 = ya). */
  waitTime(): number {
    const now = this.now();
    this.log = this.log.filter((t) => now - t < this.maxWindow);
    let wait = 0;
    for (const w of this.opts.windows) {
      const inWindow = this.log.filter((t) => now - t < w.windowMs);
      if (inWindow.length >= w.limit) {
        // Se libera un lugar cuando expira la request más vieja que "sobra".
        const oldest = inWindow[inWindow.length - w.limit];
        wait = Math.max(wait, oldest + w.windowMs - now);
      }
    }
    const last = this.log[this.log.length - 1];
    if (this.opts.minIntervalMs && last !== undefined) {
      wait = Math.max(wait, last + this.opts.minIntervalMs - now);
    }
    return Math.max(0, wait);
  }

  tryAcquire(): boolean {
    if (this.waitTime() > 0) return false;
    this.log.push(this.now());
    return true;
  }

  acquire(maxWaitMs = 10_000): Promise<void> {
    const run = async () => {
      const wait = this.waitTime();
      if (wait > maxWaitMs) throw new RateLimitExceededError(wait);
      if (wait > 0) await this.sleep(wait);
      this.log.push(this.now());
    };
    const p = this.chain.then(run, run);
    this.chain = p.catch(() => undefined);
    return p;
  }

  /** Uso actual por ventana, para la pantalla de estado. */
  usage(): { limit: number; windowMs: number; used: number }[] {
    const now = this.now();
    return this.opts.windows.map((w) => ({ ...w, used: this.log.filter((t) => now - t < w.windowMs).length }));
  }
}
