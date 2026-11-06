import { describe, expect, it } from 'vitest';
import {
  classifyOrbit,
  normalizeLon,
  OrbitalError,
  SatelliteModel,
  toObserverGeodetic,
} from '../orbital/engine';
import { autoStepSec, computeGroundTrack, splitAtAntimeridian } from '../orbital/groundTrack';
import { destinationPoint, footprintGeometry, footprintPolygons } from '../orbital/footprint';
import { isSunlit, sunElevation } from '../orbital/sun';
import { CDU, fixtureModel, fixtureRecord } from './helpers';

describe('Orbital engine (SGP4/SDP4)', () => {
  it('propaga la ISS a una altitud LEO plausible', () => {
    const iss = fixtureModel('iss');
    const t = iss.epoch + 3_600_000;
    const p = iss.position(t)!;
    expect(p.altitudeKm).toBeGreaterThan(400);
    expect(p.altitudeKm).toBeLessThan(440);
    expect(p.velocityKmS).toBeCloseTo(7.66, 1);
    // La latitud nunca supera la inclinación orbital (51.6°).
    expect(Math.abs(p.latitude)).toBeLessThanOrEqual(iss.orbit.inclinationDeg + 0.2);
  });

  it('clasifica LEO, MEO, GEO y HEO a partir de los elementos reales', () => {
    expect(fixtureModel('iss').orbit.orbitClass).toBe('LEO');
    expect(fixtureModel('noaa19').orbit.orbitClass).toBe('LEO');
    expect(fixtureModel('gps').orbit.orbitClass).toBe('MEO');
    expect(fixtureModel('goes16').orbit.orbitClass).toBe('GEO');
    expect(fixtureModel('molniya').orbit.orbitClass).toBe('HEO');
    expect(classifyOrbit(1436, 0.0002, 35786)).toBe('GEO');
  });

  it('período de GPS ≈ medio día sidéreo (≈ 718 min)', () => {
    expect(fixtureModel('gps').orbit.periodMin).toBeCloseTo(718, -1);
  });

  it('GEO: el punto subsatelital casi no se mueve en 6 h (SDP4)', () => {
    const goes = fixtureModel('goes16');
    const a = goes.position(goes.epoch)!;
    const b = goes.position(goes.epoch + 6 * 3_600_000)!;
    expect(Math.abs(a.longitude - b.longitude)).toBeLessThan(1);
    expect(a.altitudeKm).toBeGreaterThan(35_700);
    expect(a.altitudeKm).toBeLessThan(35_900);
  });

  it('acepta objetos con NORAD ID de 6 dígitos vía OMM (no representables en TLE)', () => {
    const sl = fixtureModel('starlink6');
    expect(sl.noradId).toBeGreaterThan(99_999);
    expect(sl.position(sl.epoch)).not.toBeNull();
  });

  it('la época se lee del satrec y coincide con el campo EPOCH del OMM', () => {
    const rec = fixtureRecord('iss');
    expect(Math.abs(new SatelliteModel(rec).epoch - rec.epoch)).toBeLessThan(5);
  });

  it('rechaza elementos inválidos con OrbitalError', () => {
    const rec = fixtureRecord('iss');
    const bad = {
      ...rec,
      elements: { format: 'omm' as const, omm: { ...(rec.elements as { omm: object }).omm, ECCENTRICITY: 1.5 } },
    };
    expect(() => new SatelliteModel(bad as typeof rec)).toThrow(OrbitalError);
  });

  it('azimut/elevación: un GEO a la longitud del observador está al Norte/Sur con elevación alta', () => {
    const goes = fixtureModel('goes16');
    const t = goes.epoch;
    const sub = goes.position(t)!;
    // Observador en el ecuador, 20° al este del satélite → lo ve hacia el Oeste.
    const obs = toObserverGeodetic({ latitude: 0, longitude: sub.longitude + 20, altitudeKm: 0 });
    const la = goes.look(obs, t)!;
    expect(la.azimuth).toBeGreaterThan(260);
    expect(la.azimuth).toBeLessThan(280);
    expect(la.elevation).toBeGreaterThan(60);
    // Justo debajo: cenit y rango ≈ altitud.
    const below = goes.look(toObserverGeodetic({ ...sub, altitudeKm: 0 }), t)!;
    expect(below.elevation).toBeGreaterThan(89);
    expect(below.rangeKm).toBeCloseTo(sub.altitudeKm, -1);
  });

  it('el Sol está alto al mediodía y bajo el horizonte a medianoche', () => {
    const obs = toObserverGeodetic(CDU);
    // 2026-12-21 15:00 UTC ≈ mediodía solar en Concepción del Uruguay (UTC-3, lon -58°).
    expect(sunElevation(obs, Date.UTC(2026, 11, 21, 15, 50))).toBeGreaterThan(75);
    expect(sunElevation(obs, Date.UTC(2026, 11, 21, 3, 50))).toBeLessThan(-30);
  });

  it('la ISS pasa por la sombra terrestre en cada órbita', () => {
    const iss = fixtureModel('iss');
    let lit = 0;
    let dark = 0;
    for (let i = 0; i < 93; i++) {
      const s = iss.state(iss.epoch + i * 60_000)!;
      if (isSunlit(s)) lit++;
      else dark++;
    }
    expect(lit).toBeGreaterThan(0);
    expect(dark).toBeGreaterThan(0);
  });
});

describe('Ground track y antimeridiano', () => {
  it('paso automático dentro de 30-60 s para LEO', () => {
    expect(autoStepSec(92.9)).toBeGreaterThanOrEqual(30);
    expect(autoStepSec(92.9)).toBeLessThanOrEqual(60);
    expect(autoStepSec(1436)).toBeLessThanOrEqual(600);
  });

  it('corta la polilínea e interpola el cruce exacto en ±180°', () => {
    const segs = splitAtAntimeridian([
      { latitude: 0, longitude: 170 },
      { latitude: 10, longitude: 178 },
      { latitude: 12, longitude: -178 }, // salto de 356°
      { latitude: 14, longitude: -170 },
    ]);
    expect(segs).toHaveLength(2);
    expect(segs[0].at(-1)).toEqual({ latitude: 11, longitude: 180 });
    expect(segs[1][0]).toEqual({ latitude: 11, longitude: -180 });
  });

  it('también en sentido Oeste (−180 → 180)', () => {
    const segs = splitAtAntimeridian([
      { latitude: 0, longitude: -179 },
      { latitude: 2, longitude: 179 },
    ]);
    expect(segs[0].at(-1)!.longitude).toBe(-180);
    expect(segs[1][0].longitude).toBe(180);
    expect(segs[0].at(-1)!.latitude).toBeCloseTo(1);
  });

  it('ningún segmento del ground track real tiene saltos > 180° y cubre ≥ 1 órbita', () => {
    const iss = fixtureModel('iss');
    const gt = computeGroundTrack(iss, iss.epoch);
    const all = [...gt.past, ...gt.future];
    expect(gt.future.length).toBeGreaterThan(1); // una órbita LEO siempre cruza el antimeridiano
    for (const seg of all) {
      for (let i = 1; i < seg.length; i++) {
        expect(Math.abs(seg[i].longitude - seg[i - 1].longitude)).toBeLessThan(180);
      }
    }
    const futurePts = gt.future.reduce((n, s) => n + s.length, 0);
    expect(futurePts * gt.stepSec).toBeGreaterThanOrEqual(iss.orbit.periodMin * 60);
  });
});

describe('Footprint', () => {
  it('radio de cobertura de la ISS coincide con el que publica Where the ISS at? (~2264 km)', () => {
    // WTIA reporta footprint = 4528 km de diámetro para h ≈ 424 km (horizonte, ε = 0°).
    const g = footprintGeometry(424.1, 0);
    expect(g.groundRadiusKm * 2).toBeGreaterThan(4528 * 0.99);
    expect(g.groundRadiusKm * 2).toBeLessThan(4528 * 1.01);
  });

  it('a mayor elevación mínima, menor footprint', () => {
    const e0 = footprintGeometry(550, 0).groundRadiusKm;
    const e25 = footprintGeometry(550, 25).groundRadiusKm; // típico de Starlink
    expect(e25).toBeLessThan(e0 / 2);
  });

  it('GEO con ε = 0 cubre ≈ 81° de ángulo central (≈ 42 % de la Tierra)', () => {
    const g = footprintGeometry(35_786, 0);
    expect(g.centralAngleDeg).toBeCloseTo(81.3, 0);
    expect(g.areaKm2 / (4 * Math.PI * 6378.137 ** 2)).toBeCloseTo(0.424, 2);
  });

  it('destinationPoint: 90° al Este desde (0,0) a 10° → (0,10)', () => {
    const p = destinationPoint({ latitude: 0, longitude: 0 }, 90, 10);
    expect(p.latitude).toBeCloseTo(0);
    expect(p.longitude).toBeCloseTo(10);
  });

  it('footprint simple: un polígono', () => {
    expect(footprintPolygons({ latitude: -30, longitude: -58 }, 20)).toHaveLength(1);
  });

  it('footprint sobre el antimeridiano se recorta en dos polígonos válidos', () => {
    const polys = footprintPolygons({ latitude: 10, longitude: 175 }, 20);
    expect(polys).toHaveLength(2);
    for (const poly of polys) {
      const lons = poly.map((p) => p.longitude);
      expect(Math.min(...lons)).toBeGreaterThanOrEqual(-180);
      expect(Math.max(...lons)).toBeLessThanOrEqual(180);
      expect(Math.max(...lons) - Math.min(...lons)).toBeLessThan(180);
    }
  });

  it('footprint que contiene un polo se convierte en franjas que cierran contra el borde del mapa', () => {
    const polys = footprintPolygons({ latitude: 75, longitude: 30 }, 25);
    expect(polys.length).toBe(4);
    for (const poly of polys) {
      const lons = poly.map((p) => p.longitude);
      expect(Math.max(...lons) - Math.min(...lons)).toBeLessThanOrEqual(90 + 1e-9);
      expect(Math.max(...poly.map((p) => p.latitude))).toBeCloseTo(85);
    }
  });

  it('normalizeLon', () => {
    expect(normalizeLon(190)).toBe(-170);
    expect(normalizeLon(-190)).toBe(170);
    expect(normalizeLon(180)).toBe(-180);
  });
});

describe('Capa de constelación', () => {
  it('propaga en lote y agrupa por grilla según el zoom', async () => {
    const { propagateBatch, propagateBatchAsync, clusterPoints } = await import('../orbital/constellation');
    const { starlinkSample } = await import('./helpers');
    const models = starlinkSample().map((r) => new SatelliteModel(r));
    const t = models[0].epoch;
    const pts = propagateBatch(models, t);
    expect(pts.length).toBe(models.length);
    expect(await propagateBatchAsync(models, t, 7, async () => {})).toEqual(pts);

    const world = clusterPoints(pts, { latitude: 0, longitude: 0, latitudeDelta: 170, longitudeDelta: 360 }, 4);
    expect(world.reduce((n, c) => n + c.count, 0)).toBe(pts.length);
    expect(world.length).toBeLessThanOrEqual(4 * 4 * 2 + 4);
    const zoomed = clusterPoints(pts, { latitude: 0, longitude: 0, latitudeDelta: 170, longitudeDelta: 360 }, 200);
    expect(zoomed.length).toBeGreaterThan(world.length);
  });
});
