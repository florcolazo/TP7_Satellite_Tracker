/**
 * Composición de la Data Provider Layer para la app.
 *
 * Orden de prioridad (fallback):
 *   catálogo:  CelesTrak (SupGP → GP)  →  Space-Track (proxy)
 *   satélite:  CelesTrak  →  Space-Track (proxy)  →  N2YO TLE (proxy)  →  Where the ISS at? (sólo ISS)
 *   validación (todas, en paralelo): N2YO (proxy) + Where the ISS at? (ISS)
 *
 * Credenciales: la app sólo conoce la URL del proxy (EXPO_PUBLIC_PROXY_URL).
 * Usuario/contraseña de Space-Track y la API key de N2YO viven en server/.env.
 */
import { requestJson, type HttpContext } from '../core/data/http';
import { CelesTrakProvider } from '../core/data/providers/CelesTrakProvider';
import type { ProxyConfig } from '../core/data/providers/DataProvider';
import { N2yoProvider } from '../core/data/providers/N2yoProvider';
import { SpaceTrackProvider } from '../core/data/providers/SpaceTrackProvider';
import { WhereTheIssProvider } from '../core/data/providers/WhereTheIssProvider';
import { RateLimiter } from '../core/data/rateLimiter';
import { OrbitalRepository, RequestLog } from '../core/data/repository';
import { SqliteOrbitalStore } from './sqliteStore';

export const requestLog = new RequestLog(150);

export const proxyConfig: ProxyConfig = {
  baseUrl: process.env.EXPO_PUBLIC_PROXY_URL?.replace(/\/$/, '') || undefined,
  token: process.env.EXPO_PUBLIC_PROXY_TOKEN || undefined,
};

const http: HttpContext = {
  fetch: (url, init) => fetch(url, init),
  timeoutMs: 25_000,
  onLog: requestLog.push,
};

export const providers = {
  celestrak: new CelesTrakProvider(http),
  spacetrack: new SpaceTrackProvider(http, proxyConfig),
  n2yo: new N2yoProvider(http, proxyConfig),
  wheretheiss: new WhereTheIssProvider(http),
};

export const repository = new OrbitalRepository(new SqliteOrbitalStore(), [
  providers.celestrak,
  providers.spacetrack,
  providers.n2yo,
  providers.wheretheiss,
]);

const proxyLimiter = new RateLimiter({ windows: [{ limit: 30, windowMs: 60_000 }] });

/** Estado del proxy para la pantalla de ajustes. */
export async function proxyHealth(): Promise<{ ok: boolean; detail: string }> {
  if (!proxyConfig.baseUrl) return { ok: false, detail: 'No configurado (EXPO_PUBLIC_PROXY_URL)' };
  try {
    const r = await requestJson<{ n2yo: boolean; spacetrack: boolean }>(
      { ...http, retry: { retries: 0, baseDelayMs: 0, maxDelayMs: 0 }, timeoutMs: 5000 },
      proxyLimiter, 'n2yo', 'health', `${proxyConfig.baseUrl}/health`,
    );
    return { ok: true, detail: `N2YO ${r.n2yo ? '✓' : '✗ sin key'} · Space-Track ${r.spacetrack ? '✓' : '✗ sin cuenta'}` };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}
