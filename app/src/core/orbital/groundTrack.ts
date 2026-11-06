/**
 * Ground track (RF-11): traza del punto subsatelital sobre la superficie.
 *
 * Problema del antimeridiano: un mapa Mercator representa longitudes en
 * [-180, 180). Si dos muestras consecutivas están en 179° y -179°, una
 * polilínea ingenua las une atravesando TODO el mapa. Solución: cuando el
 * salto de longitud entre muestras supera 180°, se corta la polilínea y se
 * interpola la latitud exacta del cruce, de modo que cada segmento llegue
 * prolijamente hasta el borde (±180°) y el siguiente continúe desde el otro.
 */
import type { LatLng } from '../types';
import { normalizeLon, type SatelliteModel } from './engine';

export interface GroundTrackOptions {
  /** Minutos hacia atrás desde `center`. Por defecto: medio período. */
  pastMin?: number;
  /** Minutos hacia adelante. Por defecto: un período completo (+5 %). */
  futureMin?: number;
  /** Paso de muestreo en segundos. Por defecto: adaptado al período. */
  stepSec?: number;
}

export interface GroundTrack {
  past: LatLng[][];
  future: LatLng[][];
  stepSec: number;
}

/**
 * Paso automático: ~150 muestras por órbita, acotado a [30 s, 600 s].
 * LEO (≈ 92 min) → ≈ 37 s, en el rango 30-60 s que pide el enunciado;
 * GEO (≈ 1436 min) → 574 s, porque se mueve muy poco sobre el mapa.
 */
export function autoStepSec(periodMin: number): number {
  return Math.min(600, Math.max(30, Math.round((periodMin * 60) / 150)));
}

export function computeGroundTrack(model: SatelliteModel, center: number, opts: GroundTrackOptions = {}): GroundTrack {
  const period = model.orbit.periodMin;
  const stepSec = opts.stepSec ?? autoStepSec(period);
  // GEO: una órbita entera dibuja sólo un "8" pequeño; limitamos a 24 h.
  const pastMin = opts.pastMin ?? Math.min(period / 2, 720);
  const futureMin = opts.futureMin ?? Math.min(period * 1.05, 1440);

  const sample = (from: number, to: number): LatLng[] => {
    const pts: LatLng[] = [];
    const stepMs = stepSec * 1000;
    for (let t = from; t < to; t += stepMs) {
      const p = model.position(t);
      if (p) pts.push({ latitude: p.latitude, longitude: p.longitude });
    }
    const last = model.position(to);
    if (last) pts.push({ latitude: last.latitude, longitude: last.longitude });
    return pts;
  };

  return {
    past: splitAtAntimeridian(sample(center - pastMin * 60_000, center)),
    future: splitAtAntimeridian(sample(center, center + futureMin * 60_000)),
    stepSec,
  };
}

/**
 * Divide una secuencia de puntos en segmentos que no crucen el antimeridiano,
 * agregando el punto de cruce interpolado en ambos lados.
 */
export function splitAtAntimeridian(points: LatLng[]): LatLng[][] {
  if (points.length === 0) return [];
  const segments: LatLng[][] = [];
  let current: LatLng[] = [points[0]];

  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const dLon = b.longitude - a.longitude;
    if (Math.abs(dLon) > 180) {
      // Cruce: llevamos b al mismo "lado" que a para interpolar linealmente.
      const edge = dLon < 0 ? 180 : -180; // borde por el que sale a
      const bLonUnwrapped = b.longitude + (dLon < 0 ? 360 : -360);
      const f = (edge - a.longitude) / (bLonUnwrapped - a.longitude);
      const latX = a.latitude + f * (b.latitude - a.latitude);
      current.push({ latitude: latX, longitude: edge });
      segments.push(current);
      current = [{ latitude: latX, longitude: -edge }, b];
    } else {
      current.push(b);
    }
  }
  segments.push(current);
  return segments.filter((s) => s.length >= 2);
}

/** Utilidad compartida: deja una longitud cerca de otra de referencia (desenrollado). */
export function unwrapNear(lon: number, reference: number): number {
  return reference + normalizeLon(lon - reference);
}
