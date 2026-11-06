/**
 * Informe de validación (entregable): ejecuta los experimentos contra fuentes
 * reales y escribe los resultados en ../docs/data/ y una tabla Markdown en
 * ../docs/resultados-validacion.md.
 *
 *   npm run validate                          (sólo fuentes sin key)
 *   N2YO_API_KEY=xxxx npm run validate        (+ validación cruzada con N2YO)
 *
 * Usa EXACTAMENTE el mismo código que la app (src/core), no una copia.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { HttpContext } from '../src/core/data/http';
import { CelesTrakProvider } from '../src/core/data/providers/CelesTrakProvider';
import { WhereTheIssProvider } from '../src/core/data/providers/WhereTheIssProvider';
import { SatelliteModel, toObserverGeodetic } from '../src/core/orbital/engine';
import type { OrbitalRecord, ValidationPosition } from '../src/core/types';
import { compareWithReference, distance3dKm, errorStats, haversineKm, type ValidationSample } from '../src/core/validation/compare';

const here = dirname(fileURLToPath(import.meta.url));
const DOCS = resolve(here, '../../docs');
const DATA = resolve(DOCS, 'data');
mkdirSync(DATA, { recursive: true });

const OBSERVER = { latitude: -32.4846, longitude: -58.2321, altitudeKm: 0.025 }; // FCyT-UADER
const obsGeo = toObserverGeodetic(OBSERVER);
const http: HttpContext = { fetch: (u, i) => fetch(u, i), timeoutMs: 60_000 };
const celestrak = new CelesTrakProvider(http);
const wtia = new WhereTheIssProvider(http);
const runAt = Date.now();
const md: string[] = [];
const iso = (t: number) => new Date(t).toISOString().replace('.000Z', 'Z');
const f3 = (n: number) => n.toFixed(3);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function log(s = '') {
  console.log(s);
  md.push(s);
}

async function experiment1() {
  log('## Experimento 1 — ISS: SGP4 local vs. Where the ISS at? (serie temporal)\n');
  const ourRec = await celestrak.getOrbitalData(25544);
  const theirTle = await wtia.getOrbitalData();
  const model = new SatelliteModel(ourRec);
  const offsetsH = [-48, -24, -12, -6, -1, 0, 1, 6, 12, 24];
  const refs = await wtia.getPositionsAt(offsetsH.map((h) => runAt + h * 3_600_000));
  const samples = refs.map((r) => compareWithReference(model, r, obsGeo)).filter((s): s is ValidationSample => !!s);

  log(`- Nuestros elementos: CelesTrak GP (OMM), época ${iso(model.epoch)}`);
  log(`- Elementos de Where the ISS at?: TLE con época ${iso(theirTle.epoch)} (${Math.abs(theirTle.epoch - ourRec.epoch) < 1000 ? 'mismo set: OMM con más decimales vs. TLE de ancho fijo' : 'set distinto'})`);
  log(`- Instante de ejecución: ${iso(runAt)}\n`);
  log('| Offset | Instante (UTC) | Antigüedad TLE | Error horizontal (km) | Error altitud (km) | Error 3D (km) |');
  log('|---:|---|---:|---:|---:|---:|');
  samples.forEach((s, i) =>
    log(`| ${offsetsH[i] >= 0 ? '+' : ''}${offsetsH[i]} h | ${iso(s.timestamp)} | ${s.dataAgeHours.toFixed(1)} h | ${f3(s.groundErrorKm)} | ${f3(s.altitudeErrorKm)} | ${f3(s.totalErrorKm)} |`),
  );
  const st = errorStats(samples);
  log(`\n**Resumen:** n=${st.count}, error 3D medio ${f3(st.meanKm)} km, RMS ${f3(st.rmsKm)} km, máximo ${f3(st.maxKm)} km.\n`);
  return samples;
}

async function experiment2() {
  log('## Experimento 2 — ISS en vivo: 10 muestras de la posición actual\n');
  const model = new SatelliteModel(await celestrak.getOrbitalData(25544));
  const samples: ValidationSample[] = [];
  for (let i = 0; i < 10; i++) {
    const ref = await wtia.getValidationPosition(25544, OBSERVER); // el limiter espera ≥1.1 s entre requests
    const s = compareWithReference(model, ref, obsGeo);
    if (s) samples.push(s);
  }
  log('| Instante (UTC) | Lat ref | Lon ref | Alt ref (km) | Error 3D (km) |');
  log('|---|---:|---:|---:|---:|');
  for (const s of samples) log(`| ${iso(s.timestamp)} | ${s.theirs.latitude.toFixed(4)} | ${s.theirs.longitude.toFixed(4)} | ${s.theirs.altitudeKm.toFixed(2)} | ${f3(s.totalErrorKm)} |`);
  const st = errorStats(samples);
  log(`\n**Resumen:** error 3D medio ${f3(st.meanKm)} km (máx ${f3(st.maxKm)} km).\n`);
  return samples;
}

/** Diferencia entre dos sets de elementos del mismo objeto, propagados al mismo instante. */
function divergence(a: SatelliteModel, b: SatelliteModel, t: number) {
  const pa = a.position(t);
  const pb = b.position(t);
  return pa && pb ? { d3: distance3dKm(pa, pb), ground: haversineKm(pa, pb) } : null;
}

async function experiment3() {
  log('## Experimento 3 — Starlink: GP (radar, 18 SDS) vs. SupGP (efemérides del operador)\n');
  let gp: OrbitalRecord[] = [];
  let sup: OrbitalRecord[] = [];
  // SupGP se descarga como mucho una vez cada 2 h: se guarda en docs/data para re-ejecuciones.
  const cacheFile = resolve(DATA, 'starlink-supgp.json');
  const cacheGp = resolve(DATA, 'starlink-gp.json');
  try {
    const { recordFromOmm } = await import('../src/core/data/omm');
    const { existsSync, readFileSync, statSync } = await import('node:fs');
    const fresh = (p: string) => existsSync(p) && Date.now() - statSync(p).mtimeMs < 2 * 3_600_000;
    let supText: string;
    if (fresh(cacheFile)) supText = readFileSync(cacheFile, 'utf8');
    else {
      supText = await (await fetch('https://celestrak.org/NORAD/elements/supplemental/sup-gp.php?FILE=starlink&FORMAT=json')).text();
      if (!supText.trim().startsWith('[')) throw new Error(supText.trim().split('\n').join(' ').slice(0, 160));
      writeFileSync(cacheFile, supText);
    }
    sup = (JSON.parse(supText) as Record<string, unknown>[]).map((o) => recordFromOmm(o, 'celestrak', runAt, 'supgp'));
    let gpText: string;
    if (fresh(cacheGp)) gpText = readFileSync(cacheGp, 'utf8');
    else {
      await sleep(1000);
      gpText = await (await fetch('https://celestrak.org/NORAD/elements/gp.php?GROUP=starlink&FORMAT=json')).text();
      if (!gpText.trim().startsWith('[')) throw new Error(gpText.trim().slice(0, 160));
      writeFileSync(cacheGp, gpText);
    }
    gp = (JSON.parse(gpText) as Record<string, unknown>[]).map((o) => recordFromOmm(o, 'celestrak', runAt, 'gp'));
  } catch (e) {
    log(`> No se pudo ejecutar: ${(e as Error).message}`);
    log('> (CelesTrak limita SupGP a una descarga cada 2 h por IP; reintentar más tarde.)\n');
    return null;
  }
  const gpById = new Map(gp.map((r) => [r.noradId, r]));
  const pairs = sup.filter((s) => gpById.has(s.noradId));
  const step = Math.max(1, Math.floor(pairs.length / 200));
  const rows: { id: number; name: string; dEpochH: number; d0: number; d24: number }[] = [];
  for (let i = 0; i < pairs.length; i += step) {
    try {
      const a = new SatelliteModel(pairs[i]);
      const b = new SatelliteModel(gpById.get(pairs[i].noradId)!);
      const d0 = divergence(a, b, runAt);
      const d24 = divergence(a, b, runAt + 24 * 3_600_000);
      if (d0 && d24) rows.push({ id: a.noradId, name: a.name, dEpochH: (a.epoch - b.epoch) / 3_600_000, d0: d0.d3, d24: d24.d3 });
    } catch {
      /* elementos inválidos */
    }
  }
  const med = (xs: number[]) => [...xs].sort((x, y) => x - y)[Math.floor(xs.length / 2)];
  log(`- Satélites con ambos sets: ${pairs.length} (SupGP: ${sup.length}, GP: ${gp.length}); muestra analizada: ${rows.length}`);
  log(`- Objetos SupGP con NORAD de 6 dígitos (sin representación TLE): ${sup.filter((s) => s.noradId > 99_999).length}\n`);
  log('| Métrica | Ahora | +24 h |');
  log('|---|---:|---:|');
  log(`| Diferencia 3D mediana (km) | ${f3(med(rows.map((r) => r.d0)))} | ${f3(med(rows.map((r) => r.d24)))} |`);
  log(`| Diferencia 3D media (km) | ${f3(errorStats(rows.map((r) => ({ totalErrorKm: r.d0 }))).meanKm)} | ${f3(errorStats(rows.map((r) => ({ totalErrorKm: r.d24 }))).meanKm)} |`);
  log(`| Percentil 90 (km) | ${f3([...rows.map((r) => r.d0)].sort((a, b) => a - b)[Math.floor(rows.length * 0.9)])} | ${f3([...rows.map((r) => r.d24)].sort((a, b) => a - b)[Math.floor(rows.length * 0.9)])} |`);
  log(`| Diferencia de épocas mediana SupGP − GP (h) | ${med(rows.map((r) => r.dEpochH)).toFixed(1)} | |`);
  log('');
  return rows;
}

async function experiment4() {
  const key = process.env.N2YO_API_KEY;
  log('## Experimento 4 — Validación cruzada con N2YO\n');
  if (!key) {
    log('> Omitido: definir `N2YO_API_KEY` para ejecutarlo (`N2YO_API_KEY=xxxx npm run validate`).\n');
    return null;
  }
  const targets = [25544, 20580, 33591, 48859, 41866];
  log('| Satélite | NORAD | Clase | Antigüedad TLE | Error horiz. (km) | Error alt. (km) | Error 3D (km) | Δaz (°) | Δel (°) |');
  log('|---|---:|---|---:|---:|---:|---:|---:|---:|');
  const out: ValidationSample[] = [];
  for (const id of targets) {
    const model = new SatelliteModel(await celestrak.getOrbitalData(id));
    const url = `https://api.n2yo.com/rest/v1/satellite/positions/${id}/${OBSERVER.latitude}/${OBSERVER.longitude}/${OBSERVER.altitudeKm * 1000}/1/&apiKey=${key}`;
    const body = (await (await fetch(url)).json()) as { positions?: { satlatitude: number; satlongitude: number; sataltitude: number; azimuth: number; elevation: number; timestamp: number }[] };
    const p = body.positions?.[0];
    if (!p) continue;
    const ref: ValidationPosition = { source: 'n2yo', noradId: id, latitude: p.satlatitude, longitude: p.satlongitude, altitudeKm: p.sataltitude, azimuth: p.azimuth, elevation: p.elevation, timestamp: p.timestamp * 1000 };
    const s = compareWithReference(model, ref, obsGeo);
    if (!s) continue;
    out.push(s);
    log(`| ${model.name} | ${id} | ${model.orbit.orbitClass} | ${s.dataAgeHours.toFixed(1)} h | ${f3(s.groundErrorKm)} | ${f3(s.altitudeErrorKm)} | ${f3(s.totalErrorKm)} | ${s.azimuthErrorDeg?.toFixed(3)} | ${s.elevationErrorDeg?.toFixed(3)} |`);
    await sleep(500);
  }
  log('');
  return out;
}

async function main() {
  log(`# Resultados de validación\n\n_Generado por \`app/scripts/validate.ts\` el ${iso(runAt)}. Observador: FCyT-UADER (${OBSERVER.latitude}, ${OBSERVER.longitude})._\n`);
  const e1 = await experiment1();
  const e2 = await experiment2();
  const e3 = await experiment3();
  const e4 = await experiment4();
  writeFileSync(resolve(DATA, 'validacion.json'), JSON.stringify({ runAt, observer: OBSERVER, e1, e2, e3, e4 }, null, 1));
  writeFileSync(resolve(DOCS, 'resultados-validacion.md'), md.join('\n') + '\n');
  console.log(`\nEscrito ${resolve(DOCS, 'resultados-validacion.md')}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
