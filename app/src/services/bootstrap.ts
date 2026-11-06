/**
 * Arranque de la app: estado persistido, ubicación, notificaciones, tarea en
 * background y satélite inicial (ISS). También refresca datos vencidos cada
 * vez que la app vuelve a primer plano (RF-09).
 */
import * as Location from 'expo-location';
import { AppState as RNAppState } from 'react-native';
import { ISS_NORAD_ID } from '../core/data/providers/WhereTheIssProvider';
import { getState, hydrate, setState } from '../state/appStore';
import { registerBackgroundRefresh, rememberObserver } from './background';
import { repository } from './dataService';
import { initNotifications } from './notifications';

let gpsSub: Location.LocationSubscription | null = null;

export async function startGpsObserver(): Promise<boolean> {
  try {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (!perm.granted) return false;
    const apply = (loc: Location.LocationObject) => {
      if (getState().settings.manualObserver) return;
      const o = { latitude: loc.coords.latitude, longitude: loc.coords.longitude, altitudeKm: (loc.coords.altitude ?? 0) / 1000 };
      setState({ observer: o, observerSource: 'gps' });
      void rememberObserver(o);
    };
    const last = await Location.getLastKnownPositionAsync();
    if (last) apply(last);
    apply(await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
    gpsSub?.remove();
    gpsSub = await Location.watchPositionAsync({ accuracy: Location.Accuracy.Balanced, distanceInterval: 500 }, apply);
    return true;
  } catch {
    return false;
  }
}

/** Refresca el satélite seleccionado y los catálogos usados. Devuelve un resumen legible. */
export async function refreshAll(force = false): Promise<string> {
  const lines: string[] = [];
  const { selected, usedGroups } = getState();
  if (selected) {
    try {
      const r = await repository.getSatellite(selected.noradId, { force });
      if (r.data.epoch !== selected.epoch || r.data.fetchedAt !== selected.fetchedAt) setState({ selected: r.data });
      lines.push(`${r.data.name}: ${r.fromCache ? (r.stale ? 'caché vencida (sin conexión)' : 'caché vigente') : `descargado de ${r.source}`}`);
    } catch (e) {
      lines.push(`${selected.name}: ${e instanceof Error ? e.message : e}`);
    }
  }
  for (const g of usedGroups) {
    try {
      const r = await repository.getGroup(g, { force, limit: 1 });
      lines.push(`${g}: ${r.fromCache ? (r.stale ? 'caché vencida' : 'caché vigente') : `descargado de ${r.source}`}`);
    } catch (e) {
      lines.push(`${g}: ${e instanceof Error ? e.message : e}`);
    }
  }
  return lines.join('\n');
}

let started = false;

export async function bootstrap() {
  if (started) return;
  started = true;
  await hydrate();
  const { settings, selected } = getState();
  repository.setTtl(settings.ttlHours * 3_600_000);

  if (!selected) {
    repository
      .getSatellite(ISS_NORAD_ID)
      .then((r) => setState({ selected: r.data }))
      .catch(() => undefined);
  } else {
    void refreshAll();
  }

  void initNotifications();
  void registerBackgroundRefresh();
  if (!settings.manualObserver) void startGpsObserver();

  RNAppState.addEventListener('change', (s) => {
    if (s === 'active') void refreshAll();
  });
}
