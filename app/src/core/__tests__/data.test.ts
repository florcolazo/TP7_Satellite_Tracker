import { describe, expect, it, vi } from 'vitest';
import { CircuitBreaker } from '../data/circuitBreaker';
import { AllProvidersFailedError, ProviderError } from '../data/errors';
import { requestJson, sanitizeUrl, type HttpContext, type RequestLogEntry } from '../data/http';
import { parseOmmEpoch, recordFromTle } from '../data/omm';
import { CelesTrakProvider } from '../data/providers/CelesTrakProvider';
import { BaseProvider } from '../data/providers/DataProvider';
import { WhereTheIssProvider } from '../data/providers/WhereTheIssProvider';
import { RateLimiter, RateLimitExceededError } from '../data/rateLimiter';
import { OrbitalRepository, RequestLog } from '../data/repository';
import { backoffDelay, withRetry } from '../data/retry';
import { MemoryOrbitalStore } from '../data/store';
import type { CatalogGroup, OrbitalRecord, ProviderId } from '../types';
import { compareWithReference, distance3dKm, errorStats, haversineKm } from '../validation/compare';
import fixtures from './fixtures/omm.json';
import { fixtureModel, fixtureRecord } from './helpers';

/** Reloj controlable para tests deterministas. */
function fakeClock(start = 1_000_000) {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => (t += ms),
    sleep: async (ms: number) => {
      t += ms;
    },
  };
}

function textResponse(body: string, status = 200, headers: Record<string, string> = {}) {
  return new Response(body, { status, headers });
}

const noRetry = { retries: 0, baseDelayMs: 0, maxDelayMs: 0 };

describe('RateLimiter (ventanas múltiples)', () => {
  it('Space-Track: 30/min y 300/h', () => {
    const c = fakeClock();
    const rl = new RateLimiter({ windows: [{ limit: 30, windowMs: 60_000 }, { limit: 300, windowMs: 3_600_000 }], now: c.now });
    for (let i = 0; i < 30; i++) expect(rl.tryAcquire()).toBe(true);
    expect(rl.tryAcquire()).toBe(false);
    expect(rl.waitTime()).toBe(60_000);
    c.advance(60_000);
    expect(rl.tryAcquire()).toBe(true);
  });

  it('ventana horaria: tras 300 requests espaciadas hay que esperar aunque la de 1 min esté libre', () => {
    const c = fakeClock();
    const rl = new RateLimiter({ windows: [{ limit: 30, windowMs: 60_000 }, { limit: 300, windowMs: 3_600_000 }], now: c.now });
    for (let i = 0; i < 300; i++) {
      expect(rl.tryAcquire()).toBe(true);
      c.advance(3_000);
    }
    expect(rl.tryAcquire()).toBe(false);
    expect(rl.waitTime()).toBe(3_600_000 - 300 * 3_000);
  });

  it('intervalo mínimo (Where the ISS at? ~1 req/s)', async () => {
    const c = fakeClock();
    const rl = new RateLimiter({ windows: [{ limit: 100, windowMs: 60_000 }], minIntervalMs: 1000, now: c.now, sleep: c.sleep });
    await rl.acquire();
    const t0 = c.now();
    await rl.acquire();
    expect(c.now() - t0).toBe(1000);
  });

  it('falla rápido si la espera supera el máximo tolerado', async () => {
    const c = fakeClock();
    const rl = new RateLimiter({ windows: [{ limit: 1, windowMs: 60_000 }], now: c.now, sleep: c.sleep });
    await rl.acquire();
    await expect(rl.acquire(5_000)).rejects.toBeInstanceOf(RateLimitExceededError);
  });
});

describe('Reintentos con backoff exponencial', () => {
  it('reintenta errores de red y 5xx hasta tener éxito', async () => {
    let calls = 0;
    const delays: number[] = [];
    const r = await withRetry(
      async () => {
        calls++;
        if (calls < 3) throw new ProviderError('celestrak', 'http', 'HTTP 503', 503);
        return 'ok';
      },
      { retries: 3, baseDelayMs: 100, maxDelayMs: 10_000, sleep: async (ms) => void delays.push(ms), random: () => 1 },
    );
    expect(r).toBe('ok');
    expect(delays).toEqual([100, 200]); // 100·2⁰, 100·2¹
  });

  it('no reintenta errores 4xx ni datos inválidos', async () => {
    const fn = vi.fn(async () => {
      throw new ProviderError('celestrak', 'http', 'HTTP 403', 403);
    });
    await expect(withRetry(fn, { retries: 3, baseDelayMs: 1, maxDelayMs: 1, sleep: async () => {} })).rejects.toThrow('403');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('respeta Retry-After de un 429 y acota el backoff', () => {
    const e = new ProviderError('n2yo', 'rate-limited', '429', 429, 30_000);
    expect(backoffDelay(0, { retries: 1, baseDelayMs: 100, maxDelayMs: 1000, random: () => 1 }, e)).toBe(30_000);
    expect(backoffDelay(10, { retries: 1, baseDelayMs: 100, maxDelayMs: 1000, random: () => 1 })).toBe(1000);
  });
});

describe('Circuit breaker', () => {
  it('abre tras N fallas, pasa a semiabierto tras el cooldown y se cierra con un éxito', () => {
    const c = fakeClock();
    const b = new CircuitBreaker(3, 60_000, c.now);
    b.failure();
    b.failure();
    expect(b.canRequest()).toBe(true);
    b.failure();
    expect(b.state).toBe('open');
    c.advance(60_000);
    expect(b.state).toBe('half-open');
    b.failure(); // la prueba falla → vuelve a abrir
    expect(b.state).toBe('open');
    c.advance(60_000);
    b.success();
    expect(b.state).toBe('closed');
  });
});

describe('HTTP + proveedores reales (con fetch simulado)', () => {
  it('CelesTrak: "has not updated" en texto plano → error not-modified', async () => {
    const p = new CelesTrakProvider({
      fetch: async () => textResponse('SupGP data has not updated since last successful\nPlease limit requests to once every 2 hours'),
      retry: noRetry,
    });
    await expect(p.getOrbitalData(25544)).rejects.toMatchObject({ kind: 'not-modified' });
  });

  it('CelesTrak: Starlink usa SupGP y cae al GP estándar si SupGP no responde', async () => {
    const urls: string[] = [];
    const sample = (fixtures.starlinkSample as unknown[]).slice(0, 3);
    const p = new CelesTrakProvider({
      fetch: async (url) => {
        urls.push(url);
        return url.includes('sup-gp') ? textResponse('', 500) : textResponse(JSON.stringify(sample));
      },
      retry: noRetry,
    });
    const recs = await p.getCatalog('starlink');
    expect(recs).toHaveLength(3);
    expect(urls[0]).toContain('sup-gp.php?FILE=starlink');
    expect(urls[1]).toContain('GROUP=starlink');
    expect(recs[0].dataset).toBe('gp');
  });

  it('registra cada request y oculta secretos en la URL', async () => {
    const log: RequestLogEntry[] = [];
    const ctx: HttpContext = { fetch: async () => textResponse('{"a":1}'), onLog: (e) => log.push(e), retry: noRetry };
    await requestJson(ctx, new RateLimiter({ windows: [{ limit: 10, windowMs: 1000 }] }), 'n2yo', 'test', 'https://x.org/api?apiKey=SECRETO');
    expect(log[0].url).toBe('https://x.org/api?apiKey=***');
    expect(log[0].ok).toBe(true);
    expect(sanitizeUrl('https://a?password=x&b=1')).toBe('https://a?password=***&b=1');
  });

  it('HTTP 429 con Retry-After → error rate-limited reintentable', async () => {
    const p = new WhereTheIssProvider({ fetch: async () => textResponse('', 429, { 'retry-after': '5' }), retry: noRetry });
    await expect(p.getValidationPosition(25544, { latitude: 0, longitude: 0, altitudeKm: 0 })).rejects.toMatchObject({
      kind: 'rate-limited',
      retryAfterMs: 5000,
    });
  });

  it('Where the ISS at? sólo soporta la ISS', () => {
    const p = new WhereTheIssProvider({ fetch: fetch });
    expect(p.supportsValidation(25544)).toBe(true);
    expect(p.supportsValidation(20580)).toBe(false);
  });
});

/** Proveedor programable para probar el orquestador. */
class FakeProvider extends BaseProvider {
  readonly limiter = new RateLimiter({ windows: [{ limit: 1000, windowMs: 1000 }] });
  calls = 0;
  constructor(
    readonly id: ProviderId,
    private behavior: () => Promise<OrbitalRecord[]>,
  ) {
    super({ fetch });
  }
  readonly label = 'fake';
  override supportsCatalog() {
    return true;
  }
  override supportsOrbital() {
    return true;
  }
  setBehavior(b: () => Promise<OrbitalRecord[]>) {
    this.behavior = b;
  }
  override async getCatalog(_g: CatalogGroup) {
    this.calls++;
    return this.behavior();
  }
  override async getOrbitalData(id: number) {
    this.calls++;
    const r = (await this.behavior()).find((x) => x.noradId === id);
    if (!r) throw new ProviderError(this.id, 'not-found', 'x');
    return r;
  }
}

describe('OrbitalRepository (orquestador con caché, TTL y fallback)', () => {
  const iss = fixtureRecord('iss');
  const ok = async () => [iss];
  const down = async (): Promise<OrbitalRecord[]> => {
    throw new ProviderError('celestrak', 'network', 'offline');
  };

  it('usa la caché fresca sin hacer requests', async () => {
    const c = fakeClock();
    const a = new FakeProvider('celestrak', ok);
    const repo = new OrbitalRepository(new MemoryOrbitalStore(), [a], { now: c.now });
    await repo.getGroup('stations');
    const second = await repo.getGroup('stations');
    expect(a.calls).toBe(1);
    expect(second.fromCache).toBe(true);
    expect(second.stale).toBe(false);
  });

  it('fallback: si el primario falla se usa el secundario', async () => {
    const a = new FakeProvider('celestrak', down);
    const b = new FakeProvider('spacetrack', ok);
    const repo = new OrbitalRepository(new MemoryOrbitalStore(), [a, b]);
    const r = await repo.getGroup('stations');
    expect(r.source).toBe('spacetrack');
    expect(r.errors[0].provider).toBe('celestrak');
  });

  it('TTL vencido + todos caídos → sirve la caché marcada como stale (modo offline)', async () => {
    const c = fakeClock();
    const a = new FakeProvider('celestrak', ok);
    const repo = new OrbitalRepository(new MemoryOrbitalStore(), [a], { now: c.now, ttlMs: 12 * 3_600_000 });
    await repo.getGroup('stations');
    c.advance(13 * 3_600_000);
    a.setBehavior(down);
    const r = await repo.getGroup('stations');
    expect(r.stale).toBe(true);
    expect(r.data[0].noradId).toBe(25544);
  });

  it('"not-modified" renueva la caché sin consultar al siguiente proveedor', async () => {
    const c = fakeClock();
    const a = new FakeProvider('celestrak', ok);
    const b = new FakeProvider('spacetrack', ok);
    const repo = new OrbitalRepository(new MemoryOrbitalStore(), [a, b], { now: c.now });
    await repo.getGroup('stations');
    c.advance(13 * 3_600_000);
    a.setBehavior(async () => {
      throw new ProviderError('celestrak', 'not-modified', 'sin cambios');
    });
    const r = await repo.getGroup('stations');
    expect(r.stale).toBe(false);
    expect(b.calls).toBe(0);
    expect(r.fetchedAt).toBe(c.now());
  });

  it('sin caché y todos caídos → AllProvidersFailedError con el detalle de cada uno', async () => {
    const repo = new OrbitalRepository(new MemoryOrbitalStore(), [new FakeProvider('celestrak', down), new FakeProvider('spacetrack', down)]);
    await expect(repo.getGroup('stations')).rejects.toBeInstanceOf(AllProvidersFailedError);
  });

  it('circuit breaker: tras 3 fallas el proveedor se saltea', async () => {
    const a = new FakeProvider('celestrak', down);
    const b = new FakeProvider('spacetrack', ok);
    const repo = new OrbitalRepository(new MemoryOrbitalStore(), [a, b], { breakerThreshold: 3 });
    for (let i = 0; i < 4; i++) await repo.getGroup('stations', { force: true });
    expect(a.calls).toBe(3);
    expect(repo.health().find((h) => h.id === 'celestrak')!.circuit).toBe('open');
  });

  it('deduplica requests concurrentes idénticas', async () => {
    const a = new FakeProvider('celestrak', async () => {
      await new Promise((r) => setTimeout(r, 10));
      return [iss];
    });
    const repo = new OrbitalRepository(new MemoryOrbitalStore(), [a]);
    await Promise.all([repo.getGroup('stations'), repo.getGroup('stations'), repo.getGroup('stations')]);
    expect(a.calls).toBe(1);
  });

  it('TTL mínimo de 2 h aunque se configure menos (protege a CelesTrak)', () => {
    const repo = new OrbitalRepository(new MemoryOrbitalStore(), [], { ttlMs: 60_000 });
    expect(repo.ttl).toBe(2 * 3_600_000);
  });

  it('búsqueda local por nombre y por NORAD ID', async () => {
    const repo = new OrbitalRepository(new MemoryOrbitalStore(), [new FakeProvider('celestrak', ok)]);
    await repo.getGroup('stations');
    expect((await repo.search('zarya', null))[0].noradId).toBe(25544);
    expect((await repo.search('25544', null))[0].name).toContain('ISS');
  });

  it('RequestLog mantiene un buffer acotado', () => {
    const log = new RequestLog(2);
    for (let i = 0; i < 5; i++) log.push({ id: i } as RequestLogEntry);
    expect(log.list().map((e) => e.id)).toEqual([4, 3]);
  });
});

describe('Normalización OMM/TLE', () => {
  it('parsea EPOCH con microsegundos y sin zona como UTC', () => {
    expect(parseOmmEpoch('2026-11-05T20:28:36.809184')).toBe(Date.UTC(2026, 10, 5, 20, 28, 36, 809));
  });

  it('TLE y OMM del mismo set dan la misma posición (< 1 km)', () => {
    const tle = recordFromTle(
      'ISS (ZARYA)',
      '1 25544U 98067A   26309.85320381  .00006629  00000+0  12749-3 0  9998',
      '2 25544  51.6327 319.0560 0007195 352.5747   7.5134 15.49194530593711',
      'wheretheiss',
      0,
    );
    const omm = fixtureModel('iss');
    const tleModel = new (omm.constructor as typeof import('../orbital/engine').SatelliteModel)(tle);
    const t = omm.epoch + 30 * 60_000;
    expect(distance3dKm(omm.position(t)!, tleModel.position(t)!)).toBeLessThan(1);
    expect(tle.noradId).toBe(25544);
  });
});

describe('Validación (RF-15)', () => {
  it('haversine: 1° de latitud ≈ 111.2 km; cruza el antimeridiano por el camino corto', () => {
    expect(haversineKm({ latitude: 0, longitude: 0 }, { latitude: 1, longitude: 0 })).toBeCloseTo(111.19, 1);
    expect(haversineKm({ latitude: 0, longitude: 179.5 }, { latitude: 0, longitude: -179.5 })).toBeCloseTo(111.19, 1);
  });

  it('compara en el instante de la referencia y calcula errores', () => {
    const m = fixtureModel('iss');
    const t = m.epoch + 3_600_000;
    const ours = m.position(t)!;
    const ref = { source: 'wheretheiss' as const, noradId: 25544, latitude: ours.latitude + 0.1, longitude: ours.longitude, altitudeKm: ours.altitudeKm + 1, timestamp: t };
    const s = compareWithReference(m, ref)!;
    expect(s.groundErrorKm).toBeCloseTo(11.1, 0);
    expect(s.altitudeErrorKm).toBeCloseTo(-1, 3);
    expect(s.totalErrorKm).toBeGreaterThan(s.groundErrorKm);
    expect(s.dataAgeHours).toBeCloseTo(1, 3);
    expect(errorStats([s, s]).meanKm).toBeCloseTo(s.totalErrorKm);
  });
});

describe('SupGP "not-modified" (caso real de CelesTrak)', () => {
  const sample = (fixtures.starlinkSample as unknown[]).slice(0, 2);
  const notModified = 'SupGP data has not updated since last successful\nPlease limit requests to once every 2 hours';

  it('con caché: no degrada a GP, mantiene la caché SupGP y la marca como vigente', async () => {
    const urls: string[] = [];
    let supCalls = 0;
    const p = new CelesTrakProvider({
      fetch: async (url) => {
        urls.push(url);
        if (url.includes('sup-gp')) return textResponse(supCalls++ === 0 ? JSON.stringify(sample) : notModified);
        return textResponse(JSON.stringify(sample));
      },
      retry: noRetry,
    });
    const c = fakeClock();
    const repo = new OrbitalRepository(new MemoryOrbitalStore(), [p], { now: c.now });
    const first = await repo.getGroup('starlink');
    expect(first.data[0].dataset).toBe('supgp');
    c.advance(13 * 3_600_000);
    const second = await repo.getGroup('starlink');
    expect(second.data[0].dataset).toBe('supgp');
    expect(second.stale).toBe(false);
    expect(urls.filter((u) => u.includes('GROUP=starlink'))).toHaveLength(0);
  });

  it('sin caché (IP compartida que ya descargó): cae al GP estándar en lugar de fallar', async () => {
    const p = new CelesTrakProvider({
      fetch: async (url) => textResponse(url.includes('sup-gp') ? notModified : JSON.stringify(sample)),
      retry: noRetry,
    });
    const repo = new OrbitalRepository(new MemoryOrbitalStore(), [p]);
    const r = await repo.getGroup('starlink');
    expect(r.data).toHaveLength(2);
    expect(r.data[0].dataset).toBe('gp');
  });
});
