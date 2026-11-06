/** Último resultado de pases por satélite, para que la pantalla de detalle lo lea sin recalcular. */
import type { Pass } from '../core/types';

const cache = new Map<number, Pass[]>();

export function cachePasses(noradId: number, passes: Pass[]) {
  cache.set(noradId, passes);
}

export function getCachedPass(noradId: number, aos: number): Pass | undefined {
  return cache.get(noradId)?.find((p) => p.aos.time === aos);
}

export function getCachedPasses(noradId: number): Pass[] {
  return cache.get(noradId) ?? [];
}
