/**
 * Prediction Service (RF-04): búsqueda de ventanas de visibilidad AOS/MAX/LOS.
 *
 * ── Por qué no la búsqueda ingenua ─────────────────────────────────────────
 * Evaluar la elevación cada 1 s durante 48 h son 172 800 propagaciones SGP4
 * por satélite. En el hilo de JS de un teléfono eso bloquea la UI.
 *
 * ── Algoritmo: paso adaptativo con cota física + refinamiento ──────────────
 * 1. GRUESO. Si la elevación actual es `el` y el umbral es `ε`, el satélite
 *    no puede alcanzar `ε` antes de |ε − el| / ė_max segundos, donde ė_max es
 *    una COTA SUPERIOR de la velocidad de cambio de la elevación. Avanzamos
 *    exactamente ese tiempo (con margen): lejos del horizonte damos pasos de
 *    varios minutos y cerca del umbral pasos cortos. Como el paso nunca supera
 *    el tiempo mínimo para cruzar el umbral, NO se pueden saltear pases
 *    (salvo los que duren menos que el paso mínimo, `minStepSec`).
 *
 *    Cota de ė: la elevación de un objeto cambia como máximo a razón
 *    v_rel / rango. Con v_rel ≤ v_perigeo + v_rotación_terrestre y
 *      · el ≥ 0  → rango ≥ altura de perigeo           (pase cenital, peor caso)
 *      · el < 0  → rango ≥ distancia al horizonte = √((R+h)² − R²)
 *    obtenemos dos cotas, una para debajo y otra para encima del horizonte.
 *
 * 2. FINO. Ante un cambio de signo de (el − ε) entre dos muestras se aplica
 *    bisección hasta `precisionSec` → instante exacto de AOS o LOS.
 *
 * 3. MÁXIMO. Entre AOS y LOS la elevación es unimodal para un pase normal:
 *    búsqueda de sección dorada → instante y elevación máxima.
 *
 * Resultado típico (ISS, 48 h): ~2–3 mil evaluaciones contra 172 800 de la
 * búsqueda ingenua (ver scripts/bench.ts y docs/01-documento-tecnico.md).
 */
import type { Observer, Pass, PassPoint, SkySample } from '../types';
import { EARTH_RADIUS_KM, RAD2DEG, toObserverGeodetic, type ObserverGeodetic, type SatelliteModel } from '../orbital/engine';
import { isSunlit, OBSERVER_DARK_SUN_ELEVATION, sunElevation } from '../orbital/sun';

/** Velocidad tangencial máxima de un observador por la rotación terrestre (km/s). */
const EARTH_ROTATION_SPEED_KMS = 0.4651;
/** Margen de seguridad sobre la cota de velocidad angular. */
const SAFETY = 1.25;

export interface PassSearchOptions {
  /** Inicio de la búsqueda (ms). */
  start: number;
  /** Horizonte de búsqueda (horas). */
  durationHours: number;
  /** Elevación mínima del enlace / visibilidad (grados). */
  minElevation: number;
  maxPasses?: number;
  /** Precisión de AOS/LOS (s). */
  precisionSec?: number;
  /** Paso mínimo de la fase gruesa (s). */
  minStepSec?: number;
  /** Cantidad de muestras para el sky chart. */
  samples?: number;
}

export interface PassSearchResult {
  passes: Pass[];
  /** Número de propagaciones SGP4 realizadas (métrica de costo). */
  evaluations: number;
}

/** Cotas de la velocidad angular de elevación (grados/s). */
export interface ElevationRateBounds {
  belowHorizon: number;
  aboveHorizon: number;
  maxStepSec: number;
}

export function elevationRateBounds(model: SatelliteModel): ElevationRateBounds {
  const { perigeeKm, semiMajorAxisKm, periodMin } = model.orbit;
  const R = EARTH_RADIUS_KM;
  const hp = Math.max(perigeeKm, 150);
  const rp = R + hp;
  // Vis-viva en perigeo: v² = μ (2/r − 1/a)
  const vPerigee = Math.sqrt(398600.4418 * (2 / rp - 1 / semiMajorAxisKm));
  const vRel = vPerigee + EARTH_ROTATION_SPEED_KMS;
  const horizonRange = Math.sqrt(rp * rp - R * R);
  return {
    belowHorizon: (vRel / horizonRange) * RAD2DEG * SAFETY,
    aboveHorizon: (vRel / hp) * RAD2DEG * SAFETY,
    // Nunca más de 1/16 de órbita ni 30 min por paso (robustez ante órbitas HEO).
    maxStepSec: Math.min((periodMin * 60) / 16, 1800),
  };
}

/** Tiempo mínimo (s) para que la elevación pase de `el` a `target` dadas las cotas. */
export function minTimeToReach(el: number, target: number, b: ElevationRateBounds): number {
  const lo = Math.min(el, target);
  const hi = Math.max(el, target);
  const below = Math.max(0, Math.min(hi, 0) - lo); // tramo bajo el horizonte
  const above = Math.max(0, hi - Math.max(lo, 0)); // tramo sobre el horizonte
  return below / b.belowHorizon + above / b.aboveHorizon;
}

export function findPasses(model: SatelliteModel, observer: Observer, opts: PassSearchOptions): PassSearchResult {
  const ctx = new SearchContext(model, toObserverGeodetic(observer), opts);
  return ctx.run();
}

/**
 * Versión no bloqueante: devuelve el control al event loop entre pases para
 * que la UI siga respondiendo (equivalente liviano a un Web Worker en RN).
 */
export async function findPassesAsync(
  model: SatelliteModel,
  observer: Observer,
  opts: PassSearchOptions,
  yieldToUi: () => Promise<void> = () => new Promise((r) => setTimeout(r, 0)),
): Promise<PassSearchResult> {
  const ctx = new SearchContext(model, toObserverGeodetic(observer), opts);
  const passes: Pass[] = [];
  for (const p of ctx.iterate()) {
    passes.push(p);
    await yieldToUi();
  }
  return { passes, evaluations: ctx.evaluations };
}

class SearchContext {
  evaluations = 0;
  private readonly bounds: ElevationRateBounds;
  private readonly end: number;
  private readonly precisionMs: number;
  private readonly minStepMs: number;
  private readonly maxStepMs: number;
  private readonly minEl: number;

  constructor(
    private readonly model: SatelliteModel,
    private readonly obs: ObserverGeodetic,
    private readonly opts: PassSearchOptions,
  ) {
    this.bounds = elevationRateBounds(model);
    this.end = opts.start + opts.durationHours * 3_600_000;
    this.precisionMs = (opts.precisionSec ?? 1) * 1000;
    this.minStepMs = (opts.minStepSec ?? 5) * 1000;
    this.maxStepMs = this.bounds.maxStepSec * 1000;
    this.minEl = opts.minElevation;
  }

  run(): PassSearchResult {
    return { passes: [...this.iterate()], evaluations: this.evaluations };
  }

  /** Elevación en t; si SGP4 falla (p. ej. objeto decaído) se trata como "bajo el horizonte". */
  private el(t: number): number {
    this.evaluations++;
    return this.model.look(this.obs, t)?.elevation ?? -90;
  }

  private stepFrom(el: number): number {
    const sec = minTimeToReach(el, this.minEl, this.bounds);
    return Math.min(this.maxStepMs, Math.max(this.minStepMs, sec * 1000));
  }

  *iterate(): Generator<Pass> {
    const maxPasses = this.opts.maxPasses ?? 50;
    let count = 0;
    let t = this.opts.start;
    let el = this.el(t);
    let aos: number | null = null;
    let aosClipped = false;

    if (el >= this.minEl) {
      // Ya estamos dentro de un pase: buscar hacia atrás su AOS real (hasta 1 órbita).
      const back = this.findBackwardsCrossing(t, el);
      aos = back ?? t;
      aosClipped = back === null;
    }

    while (t < this.end && count < maxPasses) {
      const next = Math.min(this.end, t + this.stepFrom(el));
      const elNext = this.el(next);
      const wasAbove = el >= this.minEl;
      const isAbove = elNext >= this.minEl;

      if (!wasAbove && isAbove) {
        aos = this.bisect(t, next, false);
        aosClipped = false;
      } else if (wasAbove && !isAbove && aos !== null) {
        const los = this.bisect(t, next, true);
        yield this.buildPass(aos, los, aosClipped, false);
        count++;
        aos = null;
      }
      t = next;
      el = elNext;
    }

    if (aos !== null && count < maxPasses) {
      // Pase en curso al final de la ventana (p. ej. un GEO siempre visible).
      yield this.buildPass(aos, this.end, aosClipped, true);
    }
  }

  private findBackwardsCrossing(t0: number, el0: number): number | null {
    const limit = t0 - this.model.orbit.periodMin * 60_000;
    let t = t0;
    let el = el0;
    while (t > limit) {
      const prev = Math.max(limit, t - this.stepFrom(el));
      const elPrev = this.el(prev);
      if (elPrev < this.minEl) return this.bisect(prev, t, false);
      t = prev;
      el = elPrev;
    }
    return null;
  }

  /**
   * Bisección del cruce del umbral en [a, b].
   * `descending` = la elevación cae (LOS); si no, sube (AOS).
   */
  private bisect(a: number, b: number, descending: boolean): number {
    let lo = a;
    let hi = b;
    while (hi - lo > this.precisionMs) {
      const mid = (lo + hi) / 2;
      const above = this.el(mid) >= this.minEl;
      if (above !== descending) hi = mid;
      else lo = mid;
    }
    return Math.round((lo + hi) / 2);
  }

  /** Sección dorada para el máximo de elevación. */
  private findMax(a: number, b: number): number {
    const g = (Math.sqrt(5) - 1) / 2;
    let lo = a;
    let hi = b;
    let x1 = hi - g * (hi - lo);
    let x2 = lo + g * (hi - lo);
    let f1 = this.el(x1);
    let f2 = this.el(x2);
    while (hi - lo > this.precisionMs) {
      if (f1 < f2) {
        lo = x1;
        x1 = x2;
        f1 = f2;
        x2 = lo + g * (hi - lo);
        f2 = this.el(x2);
      } else {
        hi = x2;
        x2 = x1;
        f2 = f1;
        x1 = hi - g * (hi - lo);
        f1 = this.el(x1);
      }
    }
    return Math.round((lo + hi) / 2);
  }

  private point(t: number): PassPoint {
    this.evaluations++;
    const la = this.model.look(this.obs, t);
    return { time: t, azimuth: la?.azimuth ?? 0, elevation: la?.elevation ?? -90 };
  }

  private buildPass(aos: number, los: number, aosClipped: boolean, losClipped: boolean): Pass {
    const tMax = this.findMax(aos, los);
    const n = Math.max(2, this.opts.samples ?? 60);
    const samples: SkySample[] = [];
    let visual = false;
    for (let i = 0; i < n; i++) {
      const t = aos + ((los - aos) * i) / (n - 1);
      const state = this.model.state(t);
      this.evaluations++;
      if (!state) continue;
      const la = this.model.look(this.obs, t)!;
      const sunlit = isSunlit(state);
      samples.push({ time: t, ...la, sunlit });
      if (!visual && sunlit && sunElevation(this.obs, t) < OBSERVER_DARK_SUN_ELEVATION) visual = true;
    }
    return {
      noradId: this.model.noradId,
      aos: this.point(aos),
      max: this.point(tMax),
      los: this.point(los),
      durationSec: Math.round((los - aos) / 1000),
      visual,
      aosClipped,
      losClipped,
      samples,
    };
  }
}

/**
 * Búsqueda ingenua (paso fijo) — sólo para tests y benchmark: es la
 * "verdad de referencia" contra la que se valida el algoritmo refinado.
 */
export function findPassesNaive(
  model: SatelliteModel,
  observer: Observer,
  opts: { start: number; durationHours: number; minElevation: number; stepSec: number },
): { windows: { aos: number; los: number; maxEl: number }[]; evaluations: number } {
  const obs = toObserverGeodetic(observer);
  const end = opts.start + opts.durationHours * 3_600_000;
  const windows: { aos: number; los: number; maxEl: number }[] = [];
  let evaluations = 0;
  let cur: { aos: number; los: number; maxEl: number } | null = null;
  for (let t = opts.start; t <= end; t += opts.stepSec * 1000) {
    evaluations++;
    const el = model.look(obs, t)?.elevation ?? -90;
    if (el >= opts.minElevation) {
      if (!cur) cur = { aos: t, los: t, maxEl: el };
      cur.los = t;
      cur.maxEl = Math.max(cur.maxEl, el);
    } else if (cur) {
      windows.push(cur);
      cur = null;
    }
  }
  if (cur) windows.push(cur);
  return { windows, evaluations };
}
