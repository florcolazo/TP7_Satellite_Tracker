/** Caché en memoria con TTL por entrada y desalojo LRU simple al superar `capacity`. */
export class TtlCache<T> {
  private map = new Map<string, { value: T; expires: number }>();
  private readonly capacity: number;
  private readonly now: () => number;

  constructor(capacity = 500, now: () => number = Date.now) {
    this.capacity = capacity;
    this.now = now;
  }

  get size() {
    return this.map.size;
  }

  get(key: string): T | undefined {
    const e = this.map.get(key);
    if (!e) return undefined;
    if (e.expires <= this.now()) {
      this.map.delete(key);
      return undefined;
    }
    // Reinsertar para mantener orden LRU.
    this.map.delete(key);
    this.map.set(key, e);
    return e.value;
  }

  set(key: string, value: T, ttlMs: number) {
    this.map.delete(key);
    this.map.set(key, { value, expires: this.now() + ttlMs });
    while (this.map.size > this.capacity) {
      const oldest = this.map.keys().next().value as string;
      this.map.delete(oldest);
    }
  }
}
