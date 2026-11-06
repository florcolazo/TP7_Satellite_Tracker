/**
 * Parámetros de enlace a lo largo de un pase — conecta la predicción orbital
 * con el diseño de enlaces satelitales:
 *
 *   FSPL (dB) = 20·log10(d_km) + 20·log10(f_MHz) + 32.44   (pérdida de espacio libre)
 *   Doppler   Δf = −f · ṙ / c                              (ṙ = velocidad radial, km/s)
 */
import type { ObserverGeodetic, SatelliteModel } from '../orbital/engine';

const C_KMS = 299_792.458;

export function fsplDb(rangeKm: number, freqMHz: number): number {
  return 20 * Math.log10(rangeKm) + 20 * Math.log10(freqMHz) + 32.44;
}

/** Velocidad radial (km/s, + se aleja) por diferencia central de ±0.5 s. */
export function rangeRateKmS(model: SatelliteModel, obs: ObserverGeodetic, t: number): number {
  const a = model.look(obs, t - 500);
  const b = model.look(obs, t + 500);
  return a && b ? b.rangeKm - a.rangeKm : 0;
}

export function dopplerHz(rangeRate: number, freqMHz: number): number {
  return (-freqMHz * 1e6 * rangeRate) / C_KMS;
}

export interface LinkPoint {
  label: string;
  time: number;
  rangeKm: number;
  rangeRateKmS: number;
  fsplDb: number;
  dopplerHz: number;
}

export function linkAt(model: SatelliteModel, obs: ObserverGeodetic, label: string, t: number, freqMHz: number): LinkPoint | null {
  const la = model.look(obs, t);
  if (!la) return null;
  const rr = rangeRateKmS(model, obs, t);
  return { label, time: t, rangeKm: la.rangeKm, rangeRateKmS: rr, fsplDb: fsplDb(la.rangeKm, freqMHz), dopplerHz: dopplerHz(rr, freqMHz) };
}
