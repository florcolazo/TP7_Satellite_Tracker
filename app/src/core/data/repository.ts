/**
 * OrbitalRepository — el orquestador de la Data Provider Layer.
 *
 * Política de lectura (para catálogos y satélites individuales):
 *
 *   ┌─ ¿hay caché fresca (edad < TTL)? ── sí ──▶ devolver caché (0 requests)
 *   │ no
 *   ▼
 *   para cada proveedor que soporte la operación, en orden de prioridad:
 *     · circuito abierto → saltear
 *     · rate limiter lleno → saltear (no bloquear la UI)
 *     · "not-modified" (CelesTrak) → la caché sigue vigente: renovar su marca
 *     · error → registrar y probar el siguiente
 *     · éxito → guardar en caché y devolver
 *   ▼
 *   si todos fallaron: devolver la caché VENCIDA marcada `stale` (la app sigue
 *   funcionando offline en el momento del pase); sin caché → error agregado.
 *
 * Además deduplica requests idénticas concurrentes (dos pantallas pidiendo el
 * mismo grupo generan UNA sola descarga).
 */
import type { CatalogGroup, Observer, OrbitalRecord, ProviderId, ValidationPosition } from '../types';
import { CircuitBreaker, type CircuitState } from './circuitBreaker';
import { AllProvidersFailedError, ProviderError } from './errors';
import type { RequestLogEntry } from './http';
import type { DataProvider } from './providers/DataProvider';
import type { GroupMeta, OrbitalStore } from './store';

/** CelesTrak actualiza como mucho cada ~2 h: un TTL menor sólo genera requests inútiles. */
export const MIN_TTL_MS = 2 * 3_600_000;
export const DEFAULT_TTL_MS = 12 * 3_600_000;

export interface Fetched<T> {
  data: T;
  source: ProviderId;
  fetchedAt: number;
  fromCache: boolean;
  /** Datos vencidos servidos porque ningún proveedor respondió. */
  stale: boolean;
  errors: ProviderError[];
}

export interface ValidationOutcome {
  provider: ProviderId;
  label: string;
  position?: ValidationPosition;
  error?: string;
}

export interface ProviderHealth {
  id: ProviderId;
  label: string;
  circuit: CircuitState;
  consecutiveFailures: number;
  usage: { limit: number; windowMs: number; used: number }[];
  lastError?: string;
}

export interface RepositoryOptions {
  ttlMs?: number;
  now?: () => number;
  breakerThreshold?: number;
  breakerCooldownMs?: number;
}

/** Ring buffer de requests HTTP con suscriptores (pantalla "Estado de datos"). */
export class RequestLog {
  private entries: RequestLogEntry[] = [];
  private listeners = new Set<() => void>();
  constructor(private readonly capacity = 100) {}

  push = (e: RequestLogEntry) => {
    this.entries = [e, ...this.entries].slice(0, this.capacity);
    this.listeners.forEach((l) => l());
  };

  list() {
    return this.entries;
  }

  subscribe(l: () => void) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
}

export class OrbitalRepository {
  private readonly breakers = new Map<ProviderId, CircuitBreaker>();
  private readonly lastErrors = new Map<ProviderId, string>();
  private readonly inflight = new Map<string, Promise<unknown>>();
  private ttlMs: number;
  private readonly now: () => number;

  constructor(
    private readonly store: OrbitalStore,
    readonly providers: DataProvider[],
    opts: RepositoryOptions = {},
  ) {
    this.now = opts.now ?? Date.now;
    this.ttlMs = Math.max(MIN_TTL_MS, opts.ttlMs ?? DEFAULT_TTL_MS);
    for (const p of providers) {
      this.breakers.set(p.id, new CircuitBreaker(opts.breakerThreshold ?? 3, opts.breakerCooldownMs ?? 5 * 60_000, this.now));
    }
  }

  setTtl(ms: number) {
    this.ttlMs = Math.max(MIN_TTL_MS, ms);
  }

  get ttl() {
    return this.ttlMs;
  }

  isFresh(fetchedAt: number): boolean {
    return this.now() - fetchedAt < this.ttlMs;
  }

  provider<T extends DataProvider>(id: ProviderId): T | undefined {
    return this.providers.find((p) => p.id === id) as T | undefined;
  }

  // ───────────────────────────── catálogo ─────────────────────────────

  async getGroup(group: CatalogGroup, opts: { force?: boolean; limit?: number } = {}): Promise<Fetched<OrbitalRecord[]>> {
    const meta = await this.store.groupMeta(group);
    if (!opts.force && meta && this.isFresh(meta.fetchedAt)) {
      return this.fromCache(meta, (await this.store.loadGroup(group, opts.limit)) ?? [], false, []);
    }
    return this.dedupe(`group:${group}`, async () => {
      try {
        const { value, provider, errors } = await this.tryProviders(
          `catálogo ${group}`,
          (p) => p.supportsCatalog(group),
          (p) => p.getCatalog(group, { hasCache: !!meta }),
          !!meta,
        );
        const newMeta: GroupMeta = { group, fetchedAt: this.now(), source: provider, dataset: value[0]?.dataset, count: value.length };
        await this.store.saveGroup(group, value, newMeta);
        const data = opts.limit ? value.slice(0, opts.limit) : value;
        return { data, source: provider, fetchedAt: newMeta.fetchedAt, fromCache: false, stale: false, errors };
      } catch (e) {
        if (!meta) throw e;
        const records = (await this.store.loadGroup(group, opts.limit)) ?? [];
        if (e instanceof ProviderError && e.kind === 'not-modified') {
          // El proveedor confirmó que nuestros datos son los últimos publicados.
          await this.store.touchGroup(group, this.now());
          return this.fromCache({ ...meta, fetchedAt: this.now() }, records, false, [e]);
        }
        return this.fromCache(meta, records, !this.isFresh(meta.fetchedAt), e instanceof AllProvidersFailedError ? e.errors : []);
      }
    });
  }

  async groupMeta(group: CatalogGroup) {
    return this.store.groupMeta(group);
  }

  async allGroupMeta() {
    return this.store.allGroupMeta();
  }

  // ─────────────────────────── satélite individual ───────────────────────────

  async getSatellite(noradId: number, opts: { force?: boolean } = {}): Promise<Fetched<OrbitalRecord>> {
    const cached = await this.store.load(noradId);
    if (!opts.force && cached && this.isFresh(cached.fetchedAt)) {
      return { data: cached, source: cached.source, fetchedAt: cached.fetchedAt, fromCache: true, stale: false, errors: [] };
    }
    return this.dedupe(`sat:${noradId}`, async () => {
      try {
        const { value, provider, errors } = await this.tryProviders(
          `NORAD ${noradId}`,
          (p) => p.supportsOrbital(noradId),
          (p) => p.getOrbitalData(noradId),
          !!cached,
        );
        await this.store.save(value);
        return { data: value, source: provider, fetchedAt: value.fetchedAt, fromCache: false, stale: false, errors };
      } catch (e) {
        if (!cached) throw e;
        const errors = e instanceof AllProvidersFailedError ? e.errors : e instanceof ProviderError ? [e] : [];
        return {
          data: cached,
          source: cached.source,
          fetchedAt: cached.fetchedAt,
          fromCache: true,
          stale: !this.isFresh(cached.fetchedAt),
          errors,
        };
      }
    });
  }

  /** Búsqueda RF-01: primero local; si no hay resultados, online (NORAD ID o nombre). */
  async search(query: string, group: CatalogGroup | null, limit = 100): Promise<OrbitalRecord[]> {
    const q = query.trim();
    if (!q) return group ? ((await this.store.loadGroup(group, limit)) ?? []) : [];
    const local = await this.store.search(q, group, limit);
    if (local.length > 0 || group) return local;

    if (/^\d+$/.test(q)) {
      try {
        return [(await this.getSatellite(Number(q))).data];
      } catch {
        return [];
      }
    }
    if (q.length < 3) return [];
    for (const p of this.providers) {
      if (!p.supportsSearch() || !this.breakers.get(p.id)!.canRequest()) continue;
      try {
        const found = (await p.searchByName(q)).slice(0, limit);
        for (const r of found) await this.store.save(r);
        this.breakers.get(p.id)!.success();
        return found;
      } catch (e) {
        this.recordFailure(p.id, e);
      }
    }
    return [];
  }

  /** RF-09: refresca los grupos cuyo TTL venció (lo usa la tarea en background). */
  async refreshStale(groups: CatalogGroup[]): Promise<{ group: CatalogGroup; ok: boolean; source?: ProviderId }[]> {
    const out: { group: CatalogGroup; ok: boolean; source?: ProviderId }[] = [];
    for (const group of groups) {
      try {
        const r = await this.getGroup(group, { limit: 1 });
        out.push({ group, ok: !r.stale, source: r.source });
      } catch {
        out.push({ group, ok: false });
      }
    }
    return out;
  }

  // ─────────────────────────────── validación ───────────────────────────────

  /** RF-15: consulta TODAS las fuentes de validación disponibles (no es fallback: se comparan). */
  async validate(noradId: number, observer: Observer): Promise<ValidationOutcome[]> {
    const candidates = this.providers.filter((p) => p.supportsValidation(noradId));
    return Promise.all(
      candidates.map(async (p): Promise<ValidationOutcome> => {
        try {
          const position = await p.getValidationPosition(noradId, observer);
          this.breakers.get(p.id)!.success();
          return { provider: p.id, label: p.label, position };
        } catch (e) {
          this.recordFailure(p.id, e);
          return { provider: p.id, label: p.label, error: e instanceof Error ? e.message : String(e) };
        }
      }),
    );
  }

  health(): ProviderHealth[] {
    return this.providers.map((p) => {
      const b = this.breakers.get(p.id)!;
      return {
        id: p.id,
        label: p.label,
        circuit: b.state,
        consecutiveFailures: b.consecutiveFailures,
        usage: p.limiter.usage(),
        lastError: this.lastErrors.get(p.id),
      };
    });
  }

  // ─────────────────────────────── internos ───────────────────────────────

  private fromCache(meta: GroupMeta, data: OrbitalRecord[], stale: boolean, errors: ProviderError[]): Fetched<OrbitalRecord[]> {
    return { data, source: meta.source, fetchedAt: meta.fetchedAt, fromCache: true, stale, errors };
  }

  private recordFailure(id: ProviderId, e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    this.lastErrors.set(id, msg);
    // "not-supported"/"not-configured"/"not-modified" no indican que el servicio esté caído.
    if (e instanceof ProviderError && ['not-supported', 'not-configured', 'not-modified', 'not-found'].includes(e.kind)) return;
    this.breakers.get(id)?.failure();
  }

  private async tryProviders<T>(
    operation: string,
    supports: (p: DataProvider) => boolean,
    call: (p: DataProvider) => Promise<T>,
    hasCache: boolean,
  ): Promise<{ value: T; provider: ProviderId; errors: ProviderError[] }> {
    const errors: ProviderError[] = [];
    for (const p of this.providers) {
      if (!supports(p)) continue;
      const breaker = this.breakers.get(p.id)!;
      if (!breaker.canRequest()) {
        errors.push(new ProviderError(p.id, 'circuit-open', 'en cuarentena por fallas repetidas'));
        continue;
      }
      try {
        const value = await call(p);
        breaker.success();
        this.lastErrors.delete(p.id);
        return { value, provider: p.id, errors };
      } catch (e) {
        this.recordFailure(p.id, e);
        const err = e instanceof ProviderError ? e : new ProviderError(p.id, 'invalid-data', e instanceof Error ? e.message : String(e));
        // Con caché, "sin novedades" significa que la caché ES el dato vigente.
        // Sin caché (p. ej. IP compartida que ya descargó): seguir con el próximo proveedor.
        if (err.kind === 'not-modified' && hasCache) throw err;
        errors.push(err);
      }
    }
    throw new AllProvidersFailedError(operation, errors);
  }

  private dedupe<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const existing = this.inflight.get(key) as Promise<T> | undefined;
    if (existing) return existing;
    const p = fn().finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }
}
