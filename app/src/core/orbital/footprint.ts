/**
 * Footprint (RF-12): área de la superficie desde la que el satélite se ve con
 * elevación ≥ ε (elevación mínima de operación del enlace).
 *
 * Geometría (Tierra esférica de radio R, satélite a altura h):
 *
 *            Sat
 *            /|        En el triángulo Centro–Observador–Satélite:
 *         ρ / |           ángulo en el observador = 90° + ε
 *          /  | R+h       ángulo en el centro     = λ  (ángulo central)
 *    Obs  /___|           ángulo en el satélite   = η  (nadir)
 *      R   λ  Centro
 *
 *   Ley de senos  →  sin η = R·cos ε / (R + h)
 *   Suma de ángulos → λ = 90° − ε − η = arccos(R·cos ε / (R+h)) − ε
 *
 * El borde del footprint es un círculo menor de radio angular λ alrededor del
 * punto subsatelital. Para dibujarlo en Mercator hay que resolver dos casos:
 *   1. Cruza el antimeridiano → se recorta en dos (o tres) polígonos.
 *   2. Contiene un polo (GEO/MEO o LEO en latitudes altas) → el "círculo" se
 *      convierte en una banda que cubre las 360° de longitud y se cierra por
 *      el borde del mapa; se trocea en franjas de 90° para que ningún lado del
 *      polígono quede ambiguo.
 */
import type { LatLng } from '../types';
import { DEG2RAD, EARTH_RADIUS_KM, normalizeLon, RAD2DEG } from './engine';
import { unwrapNear } from './groundTrack';

/** Latitud máxima representable razonablemente en Mercator. */
export const MERCATOR_MAX_LAT = 85;

export interface FootprintGeometry {
  /** Ángulo central λ (grados). */
  centralAngleDeg: number;
  /** Radio del footprint medido sobre la superficie (km). */
  groundRadiusKm: number;
  /** Rango oblicuo máximo (km): distancia al satélite en el borde del área. */
  maxSlantRangeKm: number;
  /** Área cubierta (km²). */
  areaKm2: number;
}

export function footprintGeometry(altitudeKm: number, minElevationDeg: number): FootprintGeometry {
  const R = EARTH_RADIUS_KM;
  const eps = minElevationDeg * DEG2RAD;
  const lambda = Math.max(0, Math.acos((R * Math.cos(eps)) / (R + altitudeKm)) - eps);
  const rs = R + altitudeKm;
  return {
    centralAngleDeg: lambda * RAD2DEG,
    groundRadiusKm: R * lambda,
    maxSlantRangeKm: Math.sqrt(rs * rs - (R * Math.cos(eps)) ** 2) - R * Math.sin(eps),
    areaKm2: 2 * Math.PI * R * R * (1 - Math.cos(lambda)),
  };
}

/** Punto destino sobre la esfera dado un rumbo y una distancia angular. */
export function destinationPoint(origin: LatLng, bearingDeg: number, angularDistDeg: number): LatLng {
  const φ1 = origin.latitude * DEG2RAD;
  const λ1 = origin.longitude * DEG2RAD;
  const θ = bearingDeg * DEG2RAD;
  const δ = angularDistDeg * DEG2RAD;
  const sinφ2 = Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ);
  const φ2 = Math.asin(Math.min(1, Math.max(-1, sinφ2)));
  const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * sinφ2);
  return { latitude: φ2 * RAD2DEG, longitude: normalizeLon(λ2 * RAD2DEG) };
}

/**
 * Polígonos listos para el mapa (cada uno con longitudes en [-180, 180] y sin
 * cruzar el antimeridiano).
 */
export function footprintPolygons(center: LatLng, centralAngleDeg: number, segments = 120): LatLng[][] {
  if (centralAngleDeg <= 0) return [];
  const ring: LatLng[] = [];
  for (let i = 0; i < segments; i++) {
    ring.push(destinationPoint(center, (360 * i) / segments, centralAngleDeg));
  }

  const containsNorth = center.latitude + centralAngleDeg > 90;
  const containsSouth = center.latitude - centralAngleDeg < -90;

  if (containsNorth || containsSouth) {
    return polarCapPolygons(ring, containsNorth ? MERCATOR_MAX_LAT : -MERCATOR_MAX_LAT);
  }

  // Caso general: desenrollar longitudes alrededor del centro y recortar.
  const unwrapped = ring.map((p) => ({ latitude: clampLat(p.latitude), longitude: unwrapNear(p.longitude, center.longitude) }));
  const windows: [number, number, number][] = [
    [-540, -180, 360],
    [-180, 180, 0],
    [180, 540, -360],
  ];
  const out: LatLng[][] = [];
  for (const [min, max, shift] of windows) {
    const piece = clipLonRange(unwrapped, min, max);
    if (piece.length >= 3) out.push(piece.map((p) => ({ latitude: p.latitude, longitude: p.longitude + shift })));
  }
  return out;
}

function polarCapPolygons(ring: LatLng[], poleLat: number): LatLng[][] {
  // Cada meridiano corta el borde exactamente una vez ⇒ lat = f(lon): ordenar por longitud.
  const sorted = [...ring].sort((a, b) => a.longitude - b.longitude);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const f = (180 - last.longitude) / (first.longitude + 360 - last.longitude);
  const latEdge = last.latitude + f * (first.latitude - last.latitude);

  const band: LatLng[] = [
    { latitude: latEdge, longitude: -180 },
    ...sorted,
    { latitude: latEdge, longitude: 180 },
    { latitude: poleLat, longitude: 180 },
    { latitude: poleLat, longitude: -180 },
  ].map((p) => ({ latitude: clampLat(p.latitude), longitude: p.longitude }));

  // Franjas de 90°: ningún lado del polígono abarca ≥ 180° de longitud.
  const out: LatLng[][] = [];
  for (let lon = -180; lon < 180; lon += 90) {
    const piece = clipLonRange(densifyPoleEdge(band, poleLat), lon, lon + 90);
    if (piece.length >= 3) out.push(piece);
  }
  return out;
}

/** Inserta vértices intermedios sobre el borde polar para que el recorte por franjas sea exacto. */
function densifyPoleEdge(band: LatLng[], poleLat: number): LatLng[] {
  const out = band.slice(0, band.length - 1);
  for (let lon = 90; lon > -180; lon -= 90) out.push({ latitude: clampLat(poleLat), longitude: lon });
  out.push(band[band.length - 1]);
  return out;
}

function clampLat(lat: number): number {
  return Math.max(-MERCATOR_MAX_LAT, Math.min(MERCATOR_MAX_LAT, lat));
}

/** Sutherland–Hodgman contra las rectas verticales lon = min y lon = max. */
export function clipLonRange(poly: LatLng[], min: number, max: number): LatLng[] {
  return clipHalfPlane(clipHalfPlane(poly, min, true), max, false);
}

function clipHalfPlane(poly: LatLng[], x: number, keepGreater: boolean): LatLng[] {
  const inside = (p: LatLng) => (keepGreater ? p.longitude >= x : p.longitude <= x);
  const intersect = (a: LatLng, b: LatLng): LatLng => {
    const f = (x - a.longitude) / (b.longitude - a.longitude);
    return { latitude: a.latitude + f * (b.latitude - a.latitude), longitude: x };
  };
  const out: LatLng[] = [];
  for (let i = 0; i < poly.length; i++) {
    const cur = poly[i];
    const prev = poly[(i - 1 + poly.length) % poly.length];
    if (inside(cur)) {
      if (!inside(prev)) out.push(intersect(prev, cur));
      out.push(cur);
    } else if (inside(prev)) {
      out.push(intersect(prev, cur));
    }
  }
  return out;
}
