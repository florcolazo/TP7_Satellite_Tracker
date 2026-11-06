/**
 * Notification Layer (RF-06): recordatorios locales N minutos antes del AOS.
 *
 * Los identificadores son deterministas (`pass-<norad>-<minuto AOS>`): volver
 * a programar el mismo pase REEMPLAZA la notificación en vez de duplicarla,
 * lo que hace idempotente el re-cálculo periódico en background.
 */
import * as Notifications from 'expo-notifications';
import { AndroidImportance } from 'expo-notifications';
import { Platform } from 'react-native';
import type { Pass } from '../core/types';
import type { ScheduledReminder } from '../state/appStore';

export const PASS_CHANNEL = 'passes';

export function reminderId(noradId: number, aos: number) {
  return `pass-${noradId}-${Math.round(aos / 60_000)}`;
}

let initialized = false;

export async function initNotifications() {
  if (initialized) return;
  initialized = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
  if (Platform.OS === 'android') {
    // En Android 13+ el diálogo de permiso no aparece hasta que exista un canal.
    await Notifications.setNotificationChannelAsync(PASS_CHANNEL, {
      name: 'Pases de satélites',
      description: 'Aviso previo a un pase visible',
      importance: AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 150, 250],
      lightColor: '#38D9F5',
    });
  }
}

export async function ensureNotificationPermission(): Promise<boolean> {
  await initNotifications();
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  const req = await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowSound: true, allowBadge: false } });
  return req.granted;
}

const fmtTime = (t: number) => new Date(t).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
const compass = (az: number) => ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'][Math.round(az / 45) % 8];

export async function schedulePassReminder(pass: Pass, satName: string, leadMin: number): Promise<ScheduledReminder | null> {
  const fireAt = pass.aos.time - leadMin * 60_000;
  if (fireAt <= Date.now() + 5_000) return null;
  const id = reminderId(pass.noradId, pass.aos.time);
  await Notifications.scheduleNotificationAsync({
    identifier: id,
    content: {
      title: `🛰️ ${satName} en ${leadMin} min`,
      body:
        `Aparece ${fmtTime(pass.aos.time)} por el ${compass(pass.aos.azimuth)}, ` +
        `máx. ${pass.max.elevation.toFixed(0)}° a las ${fmtTime(pass.max.time)}` +
        (pass.visual ? ' · visible a simple vista ✨' : ' · pase de radio'),
      data: { noradId: pass.noradId, aos: pass.aos.time },
      sound: true,
    },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: fireAt, channelId: PASS_CHANNEL },
  });
  return { id, noradId: pass.noradId, satName, aos: pass.aos.time, fireAt, maxElevation: pass.max.elevation };
}

export async function cancelReminder(id: string) {
  await Notifications.cancelScheduledNotificationAsync(id);
}

/** Para la demo en video: dispara una notificación de pase en `seconds` segundos. */
export async function sendTestNotification(satName: string, pass: Pass | null, seconds = 5) {
  await Notifications.scheduleNotificationAsync({
    content: {
      title: `🛰️ ${satName} — prueba de aviso`,
      body: pass
        ? `Próximo pase: ${fmtTime(pass.aos.time)} por el ${compass(pass.aos.azimuth)}, máx. ${pass.max.elevation.toFixed(0)}°`
        : 'Las notificaciones de pase están funcionando',
      sound: true,
    },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds, channelId: PASS_CHANNEL },
  });
}
