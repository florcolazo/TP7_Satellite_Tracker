/**
 * Circuit breaker por proveedor: tras N fallas consecutivas el proveedor
 * queda "abierto" (en cuarentena) durante `cooldownMs` y el orquestador lo
 * saltea directamente, sin gastar tiempo ni cuota en un servicio caído.
 * Pasado el cooldown pasa a "semiabierto": se permite una prueba; si sale bien
 * se cierra, si falla vuelve a abrirse.
 */
export type CircuitState = 'closed' | 'open' | 'half-open';

export class CircuitBreaker {
  private failures = 0;
  private openedAt: number | null = null;

  constructor(
    private readonly threshold = 3,
    private readonly cooldownMs = 5 * 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  get state(): CircuitState {
    if (this.openedAt === null) return 'closed';
    return this.now() - this.openedAt >= this.cooldownMs ? 'half-open' : 'open';
  }

  get consecutiveFailures() {
    return this.failures;
  }

  canRequest(): boolean {
    return this.state !== 'open';
  }

  success() {
    this.failures = 0;
    this.openedAt = null;
  }

  failure() {
    this.failures++;
    if (this.state === 'half-open' || this.failures >= this.threshold) this.openedAt = this.now();
  }
}
