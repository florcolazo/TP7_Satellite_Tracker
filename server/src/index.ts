/**
 * Proxy/caché de credenciales para Satellite Tracker.
 *
 * ¿Por qué existe? La API key de N2YO y el usuario/contraseña de Space-Track
 * NO pueden viajar dentro del bundle de la app (cualquiera puede extraerlos
 * del APK). Este servidor:
 *   1. guarda las credenciales en variables de entorno (.env, fuera de git);
 *   2. mantiene la sesión (cookie) de Space-Track;
 *   3. cachea respuestas, de modo que N teléfonos consultando lo mismo
 *      generan UNA sola request al proveedor;
 *   4. aplica los límites oficiales de cada API del lado servidor (la cuota
 *      es por cuenta, compartida por todos los usuarios de la app).
 *
 * Ejecutar:  node --env-file-if-exists=.env src/index.ts   (Node ≥ 23.6, sin build)
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { SlidingWindowLimiter } from './limiter.ts';
import { TtlCache } from './cache.ts';

export interface ServerConfig {
  port: number;
  n2yoKey?: string;
  spaceTrackUser?: string;
  spaceTrackPass?: string;
  /** Token compartido con la app para que el proxy no sea un relay abierto. */
  appToken?: string;
  fetch?: typeof fetch;
}

const N2YO_BASE = 'https://api.n2yo.com/rest/v1/satellite';
const ST_BASE = 'https://www.space-track.org';

/** Consultas Space-Track por grupo (GP vigente, sin objetos decaídos). */
const SPACETRACK_GROUPS: Record<string, string> = {
  stations: 'class/gp/NORAD_CAT_ID/25544,48274/format/json',
  starlink: 'class/gp/OBJECT_NAME/STARLINK~~/DECAY_DATE/null-val/EPOCH/%3Enow-10/orderby/NORAD_CAT_ID/format/json',
  gps: 'class/gp/OBJECT_NAME/NAVSTAR~~/DECAY_DATE/null-val/EPOCH/%3Enow-30/orderby/NORAD_CAT_ID/format/json',
  weather: 'class/gp/OBJECT_NAME/NOAA~~/DECAY_DATE/null-val/EPOCH/%3Enow-30/orderby/NORAD_CAT_ID/format/json',
  geo: 'class/gp/MEAN_MOTION/0.99--1.01/ECCENTRICITY/%3C0.01/DECAY_DATE/null-val/EPOCH/%3Enow-30/orderby/NORAD_CAT_ID/format/json',
};

class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function createProxy(cfg: ServerConfig) {
  const doFetch = cfg.fetch ?? fetch;
  const cache = new TtlCache<unknown>(500);
  const limits = {
    // N2YO: 1000/h (tle, positions) y 100/h (passes, above). Margen del 5 %.
    n2yo: new SlidingWindowLimiter([{ limit: 950, windowMs: 3_600_000 }]),
    n2yoPasses: new SlidingWindowLimiter([{ limit: 95, windowMs: 3_600_000 }]),
    // Space-Track: < 30/min y < 300/h.
    spacetrack: new SlidingWindowLimiter([
      { limit: 25, windowMs: 60_000 },
      { limit: 280, windowMs: 3_600_000 },
    ]),
  };
  let stCookie: { value: string; at: number } | null = null;
  const stats = { requests: 0, cacheHits: 0, upstream: 0 };

  async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
    const hit = cache.get(key) as T | undefined;
    if (hit !== undefined) {
      stats.cacheHits++;
      return hit;
    }
    const value = await load();
    cache.set(key, value, ttlMs);
    return value;
  }

  function take(limiter: SlidingWindowLimiter, name: string) {
    const wait = limiter.tryTake();
    if (wait > 0) throw new HttpError(429, `límite de ${name} alcanzado, reintentar en ${Math.ceil(wait / 1000)} s`);
  }

  // ───────────────────────────── N2YO ─────────────────────────────
  async function n2yo(path: string, limiter: SlidingWindowLimiter): Promise<unknown> {
    if (!cfg.n2yoKey) throw new HttpError(503, 'N2YO no configurado (N2YO_API_KEY)');
    take(limiter, 'N2YO');
    stats.upstream++;
    // N2YO espera la key como "&apiKey=" al final del path.
    const res = await doFetch(`${N2YO_BASE}${path}&apiKey=${encodeURIComponent(cfg.n2yoKey)}`);
    if (!res.ok) throw new HttpError(502, `N2YO HTTP ${res.status}`);
    const body = (await res.json()) as { error?: string };
    if (body && typeof body === 'object' && 'error' in body) throw new HttpError(502, `N2YO: ${body.error}`);
    return body;
  }

  // ─────────────────────────── Space-Track ───────────────────────────
  async function spaceTrackLogin(): Promise<string> {
    if (!cfg.spaceTrackUser || !cfg.spaceTrackPass) throw new HttpError(503, 'Space-Track no configurado (SPACETRACK_USER/PASS)');
    // La sesión dura ~2 h; la renovamos a los 90 min.
    if (stCookie && Date.now() - stCookie.at < 90 * 60_000) return stCookie.value;
    take(limits.spacetrack, 'Space-Track');
    stats.upstream++;
    const res = await doFetch(`${ST_BASE}/ajaxauth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ identity: cfg.spaceTrackUser, password: cfg.spaceTrackPass }).toString(),
    });
    const cookie = res.headers.get('set-cookie')?.split(';')[0];
    if (!res.ok || !cookie) throw new HttpError(502, `login Space-Track falló (HTTP ${res.status})`);
    stCookie = { value: cookie, at: Date.now() };
    return cookie;
  }

  async function spaceTrack(query: string): Promise<unknown> {
    const cookie = await spaceTrackLogin();
    take(limits.spacetrack, 'Space-Track');
    stats.upstream++;
    const res = await doFetch(`${ST_BASE}/basicspacedata/query/${query}`, { headers: { cookie } });
    if (res.status === 401) stCookie = null;
    if (!res.ok) throw new HttpError(502, `Space-Track HTTP ${res.status}`);
    return res.json();
  }

  // ───────────────────────────── rutas ─────────────────────────────
  const num = (s: string | undefined, name: string) => {
    const n = Number(s);
    if (s === undefined || !Number.isFinite(n)) throw new HttpError(400, `parámetro inválido: ${name}`);
    return n;
  };

  async function route(path: string): Promise<{ body: unknown; maxAge: number }> {
    const p = path.split('/').filter(Boolean);

    if (p[0] === 'health') {
      return {
        body: { ok: true, n2yo: !!cfg.n2yoKey, spacetrack: !!(cfg.spaceTrackUser && cfg.spaceTrackPass), stats, cacheSize: cache.size },
        maxAge: 0,
      };
    }

    if (p[0] === 'n2yo') {
      const id = num(p[2], 'norad');
      switch (p[1]) {
        case 'tle':
          return { body: await cached(`n2yo:tle:${id}`, 3_600_000, () => n2yo(`/tle/${id}`, limits.n2yo)), maxAge: 3600 };
        case 'positions': {
          const [lat, lng, alt, secs] = [num(p[3], 'lat'), num(p[4], 'lng'), num(p[5], 'alt'), Math.min(300, num(p[6] ?? '1', 'seconds'))];
          // Posiciones: caché de 2 s (varios clientes validando a la vez comparten la request).
          const key = `n2yo:pos:${id}:${lat.toFixed(2)}:${lng.toFixed(2)}:${Math.round(alt)}:${secs}`;
          return { body: await cached(key, 2_000, () => n2yo(`/positions/${id}/${lat}/${lng}/${alt}/${secs}/`, limits.n2yo)), maxAge: 1 };
        }
        case 'radiopasses':
        case 'visualpasses': {
          const [lat, lng, alt, days, min] = [num(p[3], 'lat'), num(p[4], 'lng'), num(p[5], 'alt'), Math.min(10, num(p[6], 'days')), num(p[7], 'min')];
          const key = `n2yo:${p[1]}:${id}:${lat.toFixed(2)}:${lng.toFixed(2)}:${days}:${min}`;
          return {
            body: await cached(key, 30 * 60_000, () => n2yo(`/${p[1]}/${id}/${lat}/${lng}/${alt}/${days}/${min}/`, limits.n2yoPasses)),
            maxAge: 1800,
          };
        }
      }
    }

    if (p[0] === 'spacetrack') {
      if (p[1] === 'gp') {
        const id = num(p[2], 'norad');
        // Guía de Space-Track: no consultar GP del mismo objeto más de una vez por hora.
        return { body: await cached(`st:gp:${id}`, 3_600_000, () => spaceTrack(`class/gp/NORAD_CAT_ID/${id}/format/json`)), maxAge: 3600 };
      }
      if (p[1] === 'group') {
        const q = SPACETRACK_GROUPS[p[2] ?? ''];
        if (!q) throw new HttpError(404, `grupo desconocido: ${p[2]}`);
        return { body: await cached(`st:group:${p[2]}`, 6 * 3_600_000, () => spaceTrack(q)), maxAge: 6 * 3600 };
      }
    }

    throw new HttpError(404, 'ruta desconocida');
  }

  async function handler(req: IncomingMessage, res: ServerResponse) {
    stats.requests++;
    const url = new URL(req.url ?? '/', 'http://localhost');
    const send = (status: number, body: unknown, maxAge = 0) => {
      res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': maxAge ? `public, max-age=${maxAge}` : 'no-store',
        'access-control-allow-origin': '*',
      });
      res.end(JSON.stringify(body));
    };
    if (req.method !== 'GET') return send(405, { error: 'sólo GET' });
    if (cfg.appToken && url.pathname !== '/health' && req.headers['x-app-token'] !== cfg.appToken) {
      return send(401, { error: 'token inválido' });
    }
    try {
      const { body, maxAge } = await route(url.pathname);
      send(200, body, maxAge);
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      send(status, { error: e instanceof Error ? e.message : String(e) });
      if (status >= 500) console.warn(`[proxy] ${url.pathname} → ${status}: ${(e as Error).message}`);
    }
  }

  return { server: createServer(handler), stats };
}

// Punto de entrada (no se ejecuta cuando se importa desde los tests).
if (import.meta.main) {
  const cfg: ServerConfig = {
    port: Number(process.env.PORT ?? 8787),
    n2yoKey: process.env.N2YO_API_KEY,
    spaceTrackUser: process.env.SPACETRACK_USER,
    spaceTrackPass: process.env.SPACETRACK_PASS,
    appToken: process.env.APP_TOKEN,
  };
  const { server } = createProxy(cfg);
  server.listen(cfg.port, '0.0.0.0', () => {
    console.log(`Satellite Tracker proxy en http://0.0.0.0:${cfg.port}`);
    console.log(`  N2YO:        ${cfg.n2yoKey ? 'configurado' : 'SIN CONFIGURAR (N2YO_API_KEY)'}`);
    console.log(`  Space-Track: ${cfg.spaceTrackUser ? 'configurado' : 'SIN CONFIGURAR (SPACETRACK_USER/PASS)'}`);
    console.log(`  Token app:   ${cfg.appToken ? 'requerido' : 'no requerido'}`);
  });
}
