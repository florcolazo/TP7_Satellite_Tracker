/**
 * Iluminación solar: necesaria para distinguir pases VISUALES (el satélite
 * refleja luz solar y el observador está a oscuras) de pases sólo de radio.
 */
import * as sat from 'satellite.js';
import type { EciState, ObserverGeodetic } from './engine';
import { RAD2DEG } from './engine';

const AU_KM = 149_597_870.7;

/** Vector Sol en ECI (km) para un instante. */
export function sunEciKm(time: number) {
  const { rsun } = sat.sunPos(sat.jday(new Date(time)));
  return { x: rsun.x * AU_KM, y: rsun.y * AU_KM, z: rsun.z * AU_KM };
}

/** Elevación del Sol (grados) vista por el observador. */
export function sunElevation(observer: ObserverGeodetic, time: number): number {
  const date = new Date(time);
  const ecf = sat.eciToEcf(sunEciKm(time), sat.gstime(date));
  return sat.ecfToLookAngles(observer, ecf).elevation * RAD2DEG;
}

/**
 * ¿El satélite está iluminado? Usa el modelo de sombra cónica de satellite.js
 * (umbra + penumbra). Consideramos iluminado si menos de la mitad del disco
 * solar está tapado por la Tierra.
 */
export function isSunlit(state: EciState): boolean {
  const { rsun } = sat.sunPos(sat.jday(new Date(state.time)));
  return sat.shadowFraction(rsun, state.position) < 0.5;
}

/** Umbral del crepúsculo civil: por debajo, el cielo está lo bastante oscuro. */
export const OBSERVER_DARK_SUN_ELEVATION = -6;
