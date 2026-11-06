/** Rate limiter de ventana deslizante con varias ventanas simultáneas (lado servidor). */
export interface Window {
  limit: number;
  windowMs: number;
}

export class SlidingWindowLimiter {
  private log: number[] = [];
  private readonly windows: Window[];
  private readonly now: () => number;

  constructor(windows: Window[], now: () => number = Date.now) {
    this.windows = windows;
    this.now = now;
  }

  /** Consume un lugar si hay; devuelve 0 si se concedió o los ms a esperar si no. */
  tryTake(): number {
    const now = this.now();
    const longest = Math.max(...this.windows.map((w) => w.windowMs));
    this.log = this.log.filter((t) => now - t < longest);
    let wait = 0;
    for (const w of this.windows) {
      const inWindow = this.log.filter((t) => now - t < w.windowMs);
      if (inWindow.length >= w.limit) wait = Math.max(wait, inWindow[inWindow.length - w.limit] + w.windowMs - now);
    }
    if (wait === 0) this.log.push(now);
    return wait;
  }
}
