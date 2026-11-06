import { useEffect, useMemo, useState } from 'react';
import { SatelliteModel } from '../core/orbital/engine';
import { findPassesAsync } from '../core/prediction/passes';
import type { OrbitalRecord, Pass } from '../core/types';
import { useAppState } from '../state/appStore';
import { cachePasses } from '../state/passCache';

/** Reloj que re-renderiza cada `intervalMs`. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function useModel(record: OrbitalRecord | null): SatelliteModel | null {
  return useMemo(() => {
    if (!record) return null;
    try {
      return new SatelliteModel(record);
    } catch {
      return null;
    }
  }, [record]);
}

export function useSelectedModel() {
  const selected = useAppState((s) => s.selected);
  return useModel(selected);
}

export interface PassesState {
  passes: Pass[];
  loading: boolean;
  evaluations: number;
  computeMs: number;
  computedAt: number;
}

interface PassesResult extends Omit<PassesState, 'loading'> {
  key: string;
}

const EMPTY: PassesState = { passes: [], loading: false, evaluations: 0, computeMs: 0, computedAt: 0 };
const RECOMPUTE_MS = 10 * 60_000;

/**
 * Próximos pases del satélite seleccionado. Se calculan de forma no
 * bloqueante y se recalculan si cambian el satélite, el observador (redondeado
 * a 0.01° ≈ 1 km, para no recalcular por ruido del GPS), la elevación mínima,
 * o cada 10 minutos.
 */
export function usePasses(model: SatelliteModel | null): PassesState {
  const observer = useAppState((s) => s.observer);
  const minElevation = useAppState((s) => s.settings.minElevation);
  const passDays = useAppState((s) => s.settings.passDays);
  const [result, setResult] = useState<PassesResult | null>(null);
  const epoch = Math.floor(useNow(60_000) / RECOMPUTE_MS);

  const lat = Math.round(observer.latitude * 100) / 100;
  const lon = Math.round(observer.longitude * 100) / 100;
  const alt = Math.round(observer.altitudeKm * 10) / 10;
  const key = model ? `${model.noradId}:${model.epoch}:${lat}:${lon}:${alt}:${minElevation}:${passDays}:${epoch}` : '';

  useEffect(() => {
    if (!model) return;
    let cancelled = false;
    const t0 = Date.now();
    findPassesAsync(model, { latitude: lat, longitude: lon, altitudeKm: alt }, {
      start: t0,
      durationHours: model.orbit.orbitClass === 'LEO' ? passDays * 24 : Math.min(passDays, 2) * 24,
      minElevation,
      maxPasses: 40,
    }).then((r) => {
      if (cancelled) return;
      cachePasses(model.noradId, r.passes);
      setResult({ key, passes: r.passes, evaluations: r.evaluations, computeMs: Date.now() - t0, computedAt: Date.now() });
    });
    return () => {
      cancelled = true;
    };
  }, [model, key, lat, lon, alt, minElevation, passDays]);

  if (!model) return EMPTY;
  if (!result) return { ...EMPTY, loading: true };
  // Mientras se recalcula se siguen mostrando los pases anteriores.
  return { ...result, loading: result.key !== key };
}
