import { describe, expect, it } from 'vitest';
import { elevationRateBounds, findPasses, findPassesAsync, findPassesNaive, minTimeToReach } from '../prediction/passes';
import { toObserverGeodetic } from '../orbital/engine';
import { CDU, fixtureModel, type FixtureKey } from './helpers';

/**
 * Validación del predictor contra la búsqueda ingenua a paso de 1 s
 * (verdad de referencia). Debe encontrar EXACTAMENTE los mismos pases, con
 * AOS/LOS dentro de ±2 s y muchas menos propagaciones.
 */
describe.each<[FixtureKey, number]>([
  ['iss', 10],
  ['noaa19', 10],
  ['starlink6', 25],
  ['iss', 0],
])('Predicción de pases %s (ε = %i°) vs. fuerza bruta', (key, minElevation) => {
  const model = fixtureModel(key);
  const start = model.epoch + 3_600_000;
  const durationHours = 24;

  const refined = findPasses(model, CDU, { start, durationHours, minElevation });
  const naive = findPassesNaive(model, CDU, { start, durationHours, minElevation, stepSec: 1 });

  it('encuentra los mismos pases', () => {
    expect(refined.passes.length).toBe(naive.windows.length);
    expect(refined.passes.length).toBeGreaterThan(0);
  });

  it('AOS/LOS con precisión de ±2 s y elevación máxima con ±0.05°', () => {
    refined.passes.forEach((p, i) => {
      const ref = naive.windows[i];
      expect(Math.abs(p.aos.time - ref.aos)).toBeLessThanOrEqual(2000);
      expect(Math.abs(p.los.time - ref.los)).toBeLessThanOrEqual(2000);
      expect(Math.abs(p.max.elevation - ref.maxEl)).toBeLessThan(0.05);
      expect(p.max.time).toBeGreaterThanOrEqual(p.aos.time);
      expect(p.max.time).toBeLessThanOrEqual(p.los.time);
    });
  });

  it('usa al menos 20× menos propagaciones que la búsqueda ingenua', () => {
    expect(refined.evaluations * 20).toBeLessThan(naive.evaluations);
  });

  it('muestras del sky chart dentro del pase y sobre el umbral', () => {
    for (const p of refined.passes) {
      expect(p.samples.length).toBeGreaterThan(10);
      expect(p.samples[0].elevation).toBeGreaterThan(minElevation - 0.1);
      for (const s of p.samples) expect(s.elevation).toBeGreaterThan(minElevation - 0.1);
    }
  });
});

describe('Casos borde del predictor', () => {
  it('GEO siempre visible → un único pase continuo recortado en ambos extremos', () => {
    const goes = fixtureModel('goes16');
    const r = findPasses(goes, CDU, { start: goes.epoch, durationHours: 24, minElevation: 10 });
    expect(r.passes).toHaveLength(1);
    expect(r.passes[0].aosClipped).toBe(true);
    expect(r.passes[0].losClipped).toBe(true);
    expect(r.evaluations).toBeLessThan(500);
  });

  it('GEO bajo el horizonte → ningún pase', () => {
    const goes = fixtureModel('goes16'); // ~75° O: invisible desde Asia
    const r = findPasses(goes, { latitude: 35, longitude: 139, altitudeKm: 0 }, { start: goes.epoch, durationHours: 24, minElevation: 0 });
    expect(r.passes).toHaveLength(0);
  });

  it('inicio en medio de un pase → recupera el AOS real hacia atrás', () => {
    const iss = fixtureModel('iss');
    const first = findPasses(iss, CDU, { start: iss.epoch, durationHours: 24, minElevation: 10 }).passes[0];
    const mid = Math.round((first.aos.time + first.los.time) / 2);
    const again = findPasses(iss, CDU, { start: mid, durationHours: 2, minElevation: 10 }).passes[0];
    expect(again.aosClipped).toBe(false);
    expect(Math.abs(again.aos.time - first.aos.time)).toBeLessThanOrEqual(2000);
  });

  it('HEO (Molniya) coincide con fuerza bruta a 2 s', () => {
    const m = fixtureModel('molniya');
    const start = m.epoch;
    const refined = findPasses(m, CDU, { start, durationHours: 36, minElevation: 5 });
    const naive = findPassesNaive(m, CDU, { start, durationHours: 36, minElevation: 5, stepSec: 2 });
    expect(refined.passes.length).toBe(naive.windows.length);
  });

  it('versión asíncrona devuelve el mismo resultado', async () => {
    const iss = fixtureModel('iss');
    const opts = { start: iss.epoch, durationHours: 12, minElevation: 10 };
    const sync = findPasses(iss, CDU, opts);
    const async = await findPassesAsync(iss, CDU, opts, async () => {});
    expect(async.passes.map((p) => p.aos.time)).toEqual(sync.passes.map((p) => p.aos.time));
  });

  it('cota de velocidad angular: la ISS sobre el cenit ≈ 1°/s', () => {
    const b = elevationRateBounds(fixtureModel('iss'));
    expect(b.aboveHorizon).toBeGreaterThan(1);
    expect(b.belowHorizon).toBeLessThan(b.aboveHorizon);
    expect(minTimeToReach(-60, 10, b)).toBeGreaterThan(minTimeToReach(-10, 10, b));
  });

  it('respeta la cota física: la elevación nunca cambia más rápido que el límite', () => {
    const iss = fixtureModel('iss');
    const b = elevationRateBounds(iss);
    const obs = toObserverGeodetic(CDU);
    let prev = iss.look(obs, iss.epoch)!.elevation;
    for (let s = 1; s < 6 * 3600; s++) {
      const el = iss.look(obs, iss.epoch + s * 1000)!.elevation;
      const bound = Math.min(el, prev) >= 0 ? b.aboveHorizon : Math.max(el, prev) < 0 ? b.belowHorizon : b.aboveHorizon;
      expect(Math.abs(el - prev)).toBeLessThanOrEqual(bound);
      prev = el;
    }
  });
});
