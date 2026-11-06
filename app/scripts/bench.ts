/**
 * Benchmark de rendimiento (Node/V8). Escribe ../docs/resultados-benchmark.md.
 *   npm run bench
 * Nota: Hermes (el motor de la app) es típicamente 3-5× más lento que V8 con JIT;
 * los tiempos absolutos en el teléfono serán mayores, pero las RELACIONES
 * (evaluaciones, speed-up) se mantienen porque dependen del algoritmo.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { OMMJsonObject } from 'satellite.js';
import fixtures from '../src/core/__tests__/fixtures/omm.json';
import { recordFromOmm } from '../src/core/data/omm';
import { clusterPoints, propagateBatch } from '../src/core/orbital/constellation';
import { SatelliteModel } from '../src/core/orbital/engine';
import { footprintGeometry, footprintPolygons } from '../src/core/orbital/footprint';
import { computeGroundTrack } from '../src/core/orbital/groundTrack';
import { findPasses, findPassesNaive } from '../src/core/prediction/passes';

const here = dirname(fileURLToPath(import.meta.url));
const DOCS = resolve(here, '../../docs');
const OBS = { latitude: -32.4846, longitude: -58.2321, altitudeKm: 0.025 };
const md: string[] = [];
const log = (s = '') => (console.log(s), md.push(s));

function time<T>(fn: () => T, reps = 1): { result: T; ms: number } {
  fn(); // calentamiento JIT
  const t0 = performance.now();
  let result!: T;
  for (let i = 0; i < reps; i++) result = fn();
  return { result, ms: (performance.now() - t0) / reps };
}

const model = (k: string) => new SatelliteModel(recordFromOmm((fixtures as Record<string, unknown>)[k] as Record<string, unknown>, 'celestrak', 0));

log(`# Resultados de benchmark\n\n_Generado por \`app/scripts/bench.ts\` el ${new Date().toISOString()} · Node ${process.version} (V8)._\n`);

log('## Predicción de pases: refinamiento adaptativo vs. búsqueda ingenua\n');
log('Ventana de 72 h, elevación mínima 10°, observador FCyT-UADER. "Exactitud" = máxima diferencia de AOS/LOS contra la búsqueda ingenua a paso de 1 s.\n');
log('| Satélite | Clase | Pases | Evaluaciones (adaptativo) | Evaluaciones (ingenuo 1 s) | Reducción | Tiempo adaptativo | Tiempo ingenuo | Exactitud AOS/LOS |');
log('|---|---|---:|---:|---:|---:|---:|---:|---:|');
for (const k of ['iss', 'noaa19', 'starlink6', 'gps', 'molniya', 'goes16']) {
  const m = model(k);
  const start = m.epoch + 3_600_000;
  const opts = { start, durationHours: 72, minElevation: 10 };
  const fast = time(() => findPasses(m, OBS, opts), 3);
  const naive = time(() => findPassesNaive(m, OBS, { ...opts, stepSec: 1 }));
  const maxErr = fast.result.passes.reduce((acc, p, i) => {
    const ref = naive.result.windows[i];
    if (!ref || p.aosClipped || p.losClipped) return acc;
    return Math.max(acc, Math.abs(p.aos.time - ref.aos), Math.abs(p.los.time - ref.los));
  }, 0);
  log(
    `| ${m.name} | ${m.orbit.orbitClass} | ${fast.result.passes.length} | ${fast.result.evaluations.toLocaleString('es-AR')} | ${naive.result.evaluations.toLocaleString('es-AR')} | ×${Math.round(naive.result.evaluations / fast.result.evaluations)} | ${fast.ms.toFixed(1)} ms | ${naive.ms.toFixed(0)} ms | ${(maxErr / 1000).toFixed(1)} s |`,
  );
}

log('\n## Capa de constelación: propagación en lote\n');
const gpPath = resolve(DOCS, 'data/starlink-gp.json');
const omms: OMMJsonObject[] = existsSync(gpPath) ? JSON.parse(readFileSync(gpPath, 'utf8')) : (fixtures.starlinkSample as unknown as OMMJsonObject[]);
const all = omms.map((o) => {
  try {
    return new SatelliteModel(recordFromOmm(o as unknown as Record<string, unknown>, 'celestrak', 0));
  } catch {
    return null;
  }
}).filter((m): m is SatelliteModel => !!m);
log(`Catálogo Starlink disponible: ${all.length.toLocaleString('es-AR')} satélites.\n`);
log('| Satélites | Propagación (ms) | µs por satélite | Clusters (vista mundial) | Agrupamiento (ms) |');
log('|---:|---:|---:|---:|---:|');
const now = Date.now();
for (const n of [100, 300, 1000, 3000, all.length]) {
  if (n > all.length) continue;
  const subset = all.slice(0, n);
  const prop = time(() => propagateBatch(subset, now), 5);
  const cl = time(() => clusterPoints(prop.result, { latitude: 0, longitude: 0, latitudeDelta: 170, longitudeDelta: 360 }, 9), 5);
  log(`| ${n.toLocaleString('es-AR')} | ${prop.ms.toFixed(2)} | ${((prop.ms * 1000) / n).toFixed(1)} | ${cl.result.length} | ${cl.ms.toFixed(2)} |`);
}

log('\n## Geometría del mapa\n');
const iss = model('iss');
const gt = time(() => computeGroundTrack(iss, iss.epoch), 20);
const pts = [...gt.result.past, ...gt.result.future].reduce((n, s) => n + s.length, 0);
const fp = time(() => footprintPolygons(iss.position(iss.epoch)!, footprintGeometry(420, 10).centralAngleDeg), 200);
log(`- Ground track ISS (½ órbita pasada + 1,05 órbitas futuras, paso ${gt.result.stepSec} s): ${pts} puntos en ${gt.ms.toFixed(2)} ms (se recalcula 1 vez por minuto).`);
log(`- Footprint (120 vértices + recorte antimeridiano/polo): ${fp.ms.toFixed(3)} ms (se recalcula cada 2 s).`);
log(`- Una propagación SGP4 individual: ${((time(() => iss.position(now), 10_000).ms) * 1000).toFixed(2)} µs.`);

writeFileSync(resolve(DOCS, 'resultados-benchmark.md'), md.join('\n') + '\n');
console.log(`\nEscrito ${resolve(DOCS, 'resultados-benchmark.md')}`);
