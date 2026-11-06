/**
 * Tarea en background (RF-09 + RF-06): el sistema operativo la despierta
 * periódicamente (mínimo 15 min, sin garantía de exactitud) y:
 *   1. refresca los catálogos y satélites vigilados cuyo TTL venció,
 *      respetando caché, rate limits y fallback del repositorio;
 *   2. recalcula los pases de los satélites vigilados para las próximas 36 h
 *      y (re)programa sus notificaciones, de modo que sigan siendo correctas
 *      aunque los elementos orbitales hayan cambiado.
 *
 * `defineTask` debe ejecutarse en el ámbito global del bundle: este módulo se
 * importa desde el layout raíz.
 */
import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { SatelliteModel } from '../core/orbital/engine';
import { findPasses } from '../core/prediction/passes';
import { DEFAULT_OBSERVER, loadPersistedState, type ScheduledReminder } from '../state/appStore';
import { repository } from './dataService';
import { loadJsonRaw, saveJson } from './kv';
import { initNotifications, schedulePassReminder } from './notifications';

export const BACKGROUND_TASK = 'satellite-refresh';
const LAST_RUN_KEY = 'background-last-run';
const LAST_OBSERVER_KEY = 'last-observer';

export interface BackgroundRunReport {
  at: number;
  refreshed: string[];
  scheduled: number;
  error?: string;
}

export async function runBackgroundRefresh(): Promise<BackgroundRunReport> {
  const report: BackgroundRunReport = { at: Date.now(), refreshed: [], scheduled: 0 };
  try {
    const persisted = await loadPersistedState();
    repository.setTtl(persisted.settings.ttlHours * 3_600_000);
    const observer = persisted.settings.manualObserver ?? (await loadJsonRaw(LAST_OBSERVER_KEY)) ?? DEFAULT_OBSERVER;

    for (const r of await repository.refreshStale(persisted.usedGroups)) {
      if (r.ok) report.refreshed.push(r.group);
    }

    await initNotifications();
    const reminders: ScheduledReminder[] = [];
    for (const w of persisted.watched) {
      const rec = await repository.getSatellite(w.noradId);
      const model = new SatelliteModel(rec.data);
      const { passes } = findPasses(model, observer, {
        start: Date.now(),
        durationHours: 36,
        minElevation: persisted.settings.minElevation,
        maxPasses: 8,
        samples: 12,
      });
      for (const p of passes) {
        const r = await schedulePassReminder(p, w.name, persisted.settings.notifyLeadMin);
        if (r) reminders.push(r);
      }
    }
    report.scheduled = reminders.length;
  } catch (e) {
    report.error = e instanceof Error ? e.message : String(e);
  }
  await saveJson(LAST_RUN_KEY, report);
  return report;
}

TaskManager.defineTask(BACKGROUND_TASK, async () => {
  const r = await runBackgroundRefresh();
  return r.error ? BackgroundTask.BackgroundTaskResult.Failed : BackgroundTask.BackgroundTaskResult.Success;
});

export async function registerBackgroundRefresh() {
  try {
    const status = await BackgroundTask.getStatusAsync();
    if (status !== BackgroundTask.BackgroundTaskStatus.Available) return false;
    if (!(await TaskManager.isTaskRegisteredAsync(BACKGROUND_TASK))) {
      await BackgroundTask.registerTaskAsync(BACKGROUND_TASK, { minimumInterval: 60 });
    }
    return true;
  } catch {
    return false;
  }
}

export async function lastBackgroundRun() {
  return loadJsonRaw<BackgroundRunReport>(LAST_RUN_KEY);
}

export async function rememberObserver(o: { latitude: number; longitude: number; altitudeKm: number }) {
  await saveJson(LAST_OBSERVER_KEY, o);
}
