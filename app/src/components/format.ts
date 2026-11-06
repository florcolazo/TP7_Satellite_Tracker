import type { ProviderId } from '../core/types';

export const fmtTime = (t: number) => new Date(t).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
export const fmtHm = (t: number) => new Date(t).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
export const fmtDay = (t: number) => {
  const d = new Date(t);
  const today = new Date();
  const tomorrow = new Date(Date.now() + 86_400_000);
  if (d.toDateString() === today.toDateString()) return 'Hoy';
  if (d.toDateString() === tomorrow.toDateString()) return 'Mañana';
  return d.toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'short' });
};

export function fmtDuration(sec: number): string {
  if (sec < 60) return `${Math.round(sec)} s`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  if (m < 60) return `${m} min ${s.toString().padStart(2, '0')} s`;
  const h = Math.floor(m / 60);
  return `${h} h ${(m % 60).toString().padStart(2, '0')} min`;
}

export function fmtCountdown(ms: number): string {
  if (ms <= 0) return 'ahora';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (h > 0) return `${h} h ${m.toString().padStart(2, '0')} min`;
  return `${m}:${ss.toString().padStart(2, '0')}`;
}

export function fmtAge(hours: number): string {
  const a = Math.abs(hours);
  if (a < 1) return `${Math.round(a * 60)} min`;
  if (a < 48) return `${a.toFixed(1)} h`;
  return `${(a / 24).toFixed(1)} días`;
}

export const fmtLat = (v: number) => `${Math.abs(v).toFixed(3)}° ${v >= 0 ? 'N' : 'S'}`;
export const fmtLon = (v: number) => `${Math.abs(v).toFixed(3)}° ${v >= 0 ? 'E' : 'O'}`;

export const compassPoint = (az: number) =>
  ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSO', 'SO', 'OSO', 'O', 'ONO', 'NO', 'NNO'][Math.round(az / 22.5) % 16];

export const providerLabel: Record<ProviderId, string> = {
  celestrak: 'CelesTrak',
  spacetrack: 'Space-Track',
  n2yo: 'N2YO',
  wheretheiss: 'Where the ISS at?',
};
