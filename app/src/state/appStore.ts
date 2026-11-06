/**
 * Estado global mínimo (sin dependencias): un store observable + hook con
 * useSyncExternalStore. Persiste en kv-store lo que debe sobrevivir reinicios.
 */
import { useSyncExternalStore } from 'react';
import type { CatalogGroup, Observer, OrbitalRecord } from '../core/types';
import { loadJson, saveJson } from '../services/kv';

export interface Settings {
  /** Elevación mínima para pases y footprint (RF-04, RF-12). */
  minElevation: number;
  /** Minutos de anticipación de la notificación (RF-06). */
  notifyLeadMin: number;
  /** Máximo de satélites en la capa de constelación (RF-13). */
  constellationLimit: number;
  constellationGroup: CatalogGroup;
  showGroundTrack: boolean;
  showFootprint: boolean;
  showConstellation: boolean;
  /** TTL de la caché orbital (RF-09), 12-24 h. */
  ttlHours: number;
  /** Ubicación manual (si el usuario no da permiso de GPS o quiere simular otra estación). */
  manualObserver: Observer | null;
  /** Días a futuro para la búsqueda de pases. */
  passDays: number;
}

export const DEFAULT_SETTINGS: Settings = {
  minElevation: 10,
  notifyLeadMin: 10,
  constellationLimit: 300,
  constellationGroup: 'starlink',
  showGroundTrack: true,
  showFootprint: true,
  showConstellation: false,
  ttlHours: 12,
  manualObserver: null,
  passDays: 3,
};

/** FCyT-UADER, Concepción del Uruguay: ubicación por defecto si no hay GPS. */
export const DEFAULT_OBSERVER: Observer = { latitude: -32.4846, longitude: -58.2321, altitudeKm: 0.025 };

export type ObserverSource = 'gps' | 'manual' | 'default';

export interface ScheduledReminder {
  id: string;
  noradId: number;
  satName: string;
  aos: number;
  fireAt: number;
  maxElevation: number;
}

export interface WatchedSatellite {
  noradId: number;
  name: string;
}

export interface AppState {
  ready: boolean;
  settings: Settings;
  selected: OrbitalRecord | null;
  observer: Observer;
  observerSource: ObserverSource;
  watched: WatchedSatellite[];
  reminders: ScheduledReminder[];
  /** Grupos que el usuario consultó: son los que se refrescan en background. */
  usedGroups: CatalogGroup[];
}

let state: AppState = {
  ready: false,
  settings: DEFAULT_SETTINGS,
  selected: null,
  observer: DEFAULT_OBSERVER,
  observerSource: 'default',
  watched: [],
  reminders: [],
  usedGroups: ['stations'],
};

const listeners = new Set<() => void>();
const PERSIST_KEY = 'app-state-v1';

type Persisted = Pick<AppState, 'settings' | 'selected' | 'watched' | 'reminders' | 'usedGroups'>;

export function getState(): AppState {
  return state;
}

export function setState(patch: Partial<AppState> | ((s: AppState) => Partial<AppState>)) {
  const p = typeof patch === 'function' ? patch(state) : patch;
  state = { ...state, ...p };
  listeners.forEach((l) => l());
  if (state.ready) {
    const { settings, selected, watched, reminders, usedGroups } = state;
    void saveJson(PERSIST_KEY, { settings, selected, watched, reminders, usedGroups } satisfies Persisted);
  }
}

export function updateSettings(patch: Partial<Settings>) {
  setState((s) => ({ settings: { ...s.settings, ...patch } }));
}

export function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function useAppState<T>(selector: (s: AppState) => T): T {
  return useSyncExternalStore(subscribe, () => selector(state));
}

export async function loadPersistedState(): Promise<Persisted> {
  const p = await loadJson<Persisted>(PERSIST_KEY, {
    settings: DEFAULT_SETTINGS,
    selected: null,
    watched: [],
    reminders: [],
    usedGroups: ['stations'],
  });
  return { ...p, settings: { ...DEFAULT_SETTINGS, ...p.settings }, reminders: p.reminders.filter((r) => r.fireAt > Date.now()) };
}

export async function hydrate() {
  const p = await loadPersistedState();
  state = { ...state, ...p, ready: true };
  if (p.settings.manualObserver) {
    state = { ...state, observer: p.settings.manualObserver, observerSource: 'manual' };
  }
  listeners.forEach((l) => l());
}

export function markGroupUsed(group: CatalogGroup) {
  if (!state.usedGroups.includes(group)) setState((s) => ({ usedGroups: [...s.usedGroups, group] }));
}
