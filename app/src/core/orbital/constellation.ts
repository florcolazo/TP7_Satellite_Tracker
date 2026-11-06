/**
 * Capa de constelación (RF-13): propagar cientos de satélites y mostrarlos
 * sin degradar la UI.
 *
 * Estrategias:
 *  1. Propagación en lote por bloques, cediendo el hilo entre bloques.
 *  2. Agrupamiento por grilla dependiente del zoom: el mapa nunca dibuja más
 *     de ~cellsAcross² marcadores, aunque haya miles de satélites.
 *  3. Sólo se agrupan los puntos del viewport (+ margen).
 */
import type { LatLng } from '../types';
import type { SatelliteModel } from './engine';

export interface ConstellationPoint extends LatLng {
  noradId: number;
  name: string;
  altitudeKm: number;
}

export interface Cluster extends LatLng {
  key: string;
  count: number;
  /** Si count === 1, el satélite representado. */
  single?: ConstellationPoint;
}

export interface Viewport {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
}

export function propagateBatch(models: SatelliteModel[], time: number): ConstellationPoint[] {
  const out: ConstellationPoint[] = [];
  for (const m of models) {
    const p = m.position(time);
    if (p) out.push({ noradId: m.noradId, name: m.name, latitude: p.latitude, longitude: p.longitude, altitudeKm: p.altitudeKm });
  }
  return out;
}

export async function propagateBatchAsync(
  models: SatelliteModel[],
  time: number,
  chunkSize = 150,
  yieldToUi: () => Promise<void> = () => new Promise((r) => setTimeout(r, 0)),
): Promise<ConstellationPoint[]> {
  const out: ConstellationPoint[] = [];
  for (let i = 0; i < models.length; i += chunkSize) {
    out.push(...propagateBatch(models.slice(i, i + chunkSize), time));
    if (i + chunkSize < models.length) await yieldToUi();
  }
  return out;
}

function inViewport(p: LatLng, v: Viewport, margin: number): boolean {
  if (v.longitudeDelta >= 300) return true;
  const dLat = Math.abs(p.latitude - v.latitude);
  let dLon = Math.abs(p.longitude - v.longitude) % 360;
  if (dLon > 180) dLon = 360 - dLon;
  return dLat <= (v.latitudeDelta / 2) * margin && dLon <= (v.longitudeDelta / 2) * margin;
}

/**
 * Agrupamiento por grilla: celdas de (longitudeDelta / cellsAcross) grados.
 * O(n), estable entre refrescos (la clave de la celda no cambia si el
 * satélite no cambia de celda), ideal para re-render barato.
 */
export function clusterPoints(points: ConstellationPoint[], viewport: Viewport, cellsAcross = 10): Cluster[] {
  const cell = Math.max(0.5, Math.min(360, viewport.longitudeDelta) / cellsAcross);
  const buckets = new Map<string, { lat: number; lon: number; count: number; first: ConstellationPoint }>();
  for (const p of points) {
    if (!inViewport(p, viewport, 1.2)) continue;
    const key = `${Math.floor(p.latitude / cell)}:${Math.floor(p.longitude / cell)}`;
    const b = buckets.get(key);
    if (b) {
      b.lat += p.latitude;
      b.lon += p.longitude;
      b.count++;
    } else {
      buckets.set(key, { lat: p.latitude, lon: p.longitude, count: 1, first: p });
    }
  }
  return [...buckets.entries()].map(([key, b]) => ({
    key,
    latitude: b.count === 1 ? b.first.latitude : b.lat / b.count,
    longitude: b.count === 1 ? b.first.longitude : b.lon / b.count,
    count: b.count,
    single: b.count === 1 ? b.first : undefined,
  }));
}
