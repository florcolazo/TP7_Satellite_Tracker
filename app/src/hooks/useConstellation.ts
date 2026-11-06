import { useEffect, useRef, useState } from 'react';
import { propagateBatchAsync, type ConstellationPoint } from '../core/orbital/constellation';
import { SatelliteModel } from '../core/orbital/engine';
import type { CatalogGroup, ProviderId } from '../core/types';
import { repository } from '../services/dataService';
import { markGroupUsed } from '../state/appStore';

export interface ConstellationStatus {
  loading: boolean;
  error?: string;
  total: number;
  shown: number;
  source?: ProviderId;
  dataset?: string;
  stale?: boolean;
  /** Tiempo de la última propagación en lote (ms) — métrica de rendimiento. */
  propagateMs: number;
}

/** Submuestreo uniforme: con un límite de N, tomar 1 de cada k para cubrir todos los planos orbitales. */
export function evenSample<T>(items: T[], limit: number): T[] {
  if (items.length <= limit) return items;
  const step = items.length / limit;
  return Array.from({ length: limit }, (_, i) => items[Math.floor(i * step)]);
}

const REFRESH_MS = 3000;

interface Loaded {
  key: string;
  models: SatelliteModel[];
  error?: string;
  total: number;
  source?: ProviderId;
  dataset?: string;
  stale?: boolean;
}

/**
 * Capa de constelación (RF-13). El catálogo se descarga una vez (con caché),
 * se submuestrea a `limit` satélites y se propaga en lote cada 3 s fuera del
 * camino crítico de render (por bloques, cediendo el hilo entre bloques).
 */
export function useConstellation(enabled: boolean, group: CatalogGroup, limit: number) {
  const key = `${group}:${limit}`;
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [frame, setFrame] = useState<{ key: string; points: ConstellationPoint[]; ms: number } | null>(null);
  const busy = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    repository
      .getGroup(group)
      .then((r) => {
        if (cancelled) return;
        markGroupUsed(group);
        const models: SatelliteModel[] = [];
        for (const rec of evenSample(r.data, limit)) {
          try {
            models.push(new SatelliteModel(rec));
          } catch {
            // elementos inválidos/decaídos: se omiten
          }
        }
        setLoaded({ key, models, total: r.data.length, source: r.source, dataset: r.data[0]?.dataset, stale: r.stale });
      })
      .catch((e) => {
        if (!cancelled) setLoaded({ key, models: [], total: 0, error: e instanceof Error ? e.message : String(e) });
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, group, limit, key]);

  const models = enabled && loaded?.key === key ? loaded.models : null;

  useEffect(() => {
    if (!models || models.length === 0) return;
    let cancelled = false;
    const tick = async () => {
      if (busy.current) return; // throttling: nunca dos lotes en paralelo
      busy.current = true;
      const t0 = Date.now();
      const points = await propagateBatchAsync(models, Date.now());
      busy.current = false;
      if (!cancelled) setFrame({ key, points, ms: Date.now() - t0 });
    };
    void tick();
    const id = setInterval(tick, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [models, key]);

  const current = enabled && loaded?.key === key ? loaded : null;
  const status: ConstellationStatus = {
    loading: enabled && !current,
    error: current?.error,
    total: current?.total ?? 0,
    shown: current?.models.length ?? 0,
    source: current?.source,
    dataset: current?.dataset,
    stale: current?.stale,
    propagateMs: frame?.ms ?? 0,
  };
  return { points: enabled && frame?.key === key ? frame.points : [], status };
}
