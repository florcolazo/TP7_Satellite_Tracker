/**
 * Próximos pases (RF-04) + recordatorios (RF-06).
 */
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, SectionList, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { compassPoint, fmtCountdown, fmtDay, fmtDuration, fmtHm } from '../../components/format';
import { SkyChart } from '../../components/SkyChart';
import { Chip, EmptyState } from '../../components/ui';
import { toObserverGeodetic } from '../../core/orbital/engine';
import type { Pass } from '../../core/types';
import { useNow, usePasses, useSelectedModel } from '../../hooks/useOrbital';
import { cancelReminder, ensureNotificationPermission, schedulePassReminder, sendTestNotification } from '../../services/notifications';
import { setState, useAppState, type ScheduledReminder } from '../../state/appStore';
import { colors, radius, spacing } from '../../theme';

export default function PassesScreen() {
  const insets = useSafeAreaInsets();
  const model = useSelectedModel();
  const settings = useAppState((s) => s.settings);
  const observerSource = useAppState((s) => s.observerSource);
  const reminders = useAppState((s) => s.reminders);
  const watched = useAppState((s) => s.watched);
  const { passes, loading, evaluations, computeMs } = usePasses(model);
  const [onlyVisual, setOnlyVisual] = useState(false);
  const now = useNow(1000);
  const observer = useAppState((s) => s.observer);
  const obsGeo = useMemo(() => toObserverGeodetic(observer), [observer]);

  const upcoming = useMemo(() => passes.filter((p) => p.los.time > now && (!onlyVisual || p.visual)), [passes, now, onlyVisual]);
  const sections = useMemo(() => {
    const map = new Map<string, Pass[]>();
    for (const p of upcoming) {
      const k = fmtDay(p.aos.time);
      map.set(k, [...(map.get(k) ?? []), p]);
    }
    return [...map.entries()].map(([title, data]) => ({ title, data }));
  }, [upcoming]);

  if (!model) return <EmptyState icon="planet-outline" title="Elegí un satélite" body="Seleccioná un satélite en el catálogo para predecir sus pases." />;

  const isWatched = watched.some((w) => w.noradId === model.noradId);
  const inProgress = upcoming.find((p) => p.aos.time <= now);
  const reminderFor = (p: Pass) => reminders.find((r) => r.noradId === p.noradId && r.aos === p.aos.time);
  const naiveEvals = settings.passDays * 86_400;

  const toggleReminder = async (p: Pass) => {
    const existing = reminderFor(p);
    if (existing) {
      await cancelReminder(existing.id);
      setState((s) => ({ reminders: s.reminders.filter((r) => r.id !== existing.id) }));
      return;
    }
    if (!(await ensureNotificationPermission())) {
      Alert.alert('Notificaciones desactivadas', 'Habilitá las notificaciones para recibir avisos de pase.');
      return;
    }
    const r = await schedulePassReminder(p, model.name, settings.notifyLeadMin);
    if (!r) {
      Alert.alert('Demasiado tarde', `El pase empieza en menos de ${settings.notifyLeadMin} minutos.`);
      return;
    }
    setState((s) => ({ reminders: [...s.reminders.filter((x) => x.id !== r.id), r] }));
  };

  const toggleWatch = async () => {
    if (isWatched) {
      setState((s) => ({ watched: s.watched.filter((w) => w.noradId !== model.noradId) }));
      return;
    }
    if (!(await ensureNotificationPermission())) return;
    setState((s) => ({ watched: [...s.watched, { noradId: model.noradId, name: model.name }] }));
    const scheduled: ScheduledReminder[] = [];
    for (const p of upcoming.filter((x) => x.aos.time < Date.now() + 36 * 3_600_000)) {
      const r = await schedulePassReminder(p, model.name, settings.notifyLeadMin);
      if (r) scheduled.push(r);
    }
    setState((s) => ({ reminders: [...s.reminders.filter((x) => !scheduled.some((n) => n.id === x.id)), ...scheduled] }));
    Alert.alert('Vigilando ' + model.name, `Se programaron ${scheduled.length} avisos. En segundo plano la app recalcula los pases y renueva los avisos.`);
  };

  const testNotification = async () => {
    if (!(await ensureNotificationPermission())) return;
    await sendTestNotification(model.name, upcoming[0] ?? null, 5);
    Alert.alert('Notificación de prueba', 'Llega en 5 segundos (podés bloquear la pantalla).');
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top + spacing.sm }]}>
      <View style={styles.header}>
        <Text style={styles.title} numberOfLines={1}>
          {model.name}
        </Text>
        <Text style={styles.sub}>
          Elevación ≥ {settings.minElevation}° · próximos {settings.passDays} días · observador {observerSource === 'gps' ? 'GPS' : observerSource === 'manual' ? 'manual' : 'por defecto (FCyT)'}
        </Text>
        {!loading && evaluations > 0 && (
          <Text style={styles.perf}>
            {evaluations.toLocaleString('es-AR')} propagaciones SGP4 en {computeMs} ms · búsqueda ingenua a 1 s: {naiveEvals.toLocaleString('es-AR')} (×{Math.round(naiveEvals / evaluations)})
          </Text>
        )}
        <View style={styles.chipsRow}>
          <Chip label="Sólo visibles" icon="sparkles" active={onlyVisual} color={colors.amber} onPress={() => setOnlyVisual((v) => !v)} />
          <Chip label={isWatched ? 'Vigilando' : 'Avisarme siempre'} icon={isWatched ? 'notifications' : 'notifications-outline'} active={isWatched} onPress={toggleWatch} />
          <Chip label="Probar aviso" icon="flash-outline" onPress={testNotification} />
        </View>
      </View>

      {inProgress && (
        <Pressable onPress={() => router.push(`/pass/${inProgress.aos.time}`)} style={styles.live}>
          <SkyChart size={84} samples={inProgress.samples} current={model.look(obsGeo, now)} showLabels={false} />
          <View style={{ flex: 1 }}>
            <Text style={styles.liveTitle}>● PASE EN CURSO</Text>
            <Text style={styles.liveBody}>Termina en {fmtCountdown(inProgress.los.time - now)} · máx {inProgress.max.elevation.toFixed(0)}°</Text>
            <Text style={styles.liveLink}>Ver sky chart en vivo →</Text>
          </View>
        </Pressable>
      )}

      {loading && passes.length === 0 ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={colors.accent} />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(p) => String(p.aos.time)}
          contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.xl }}
          stickySectionHeadersEnabled={false}
          renderSectionHeader={({ section }) => <Text style={styles.day}>{section.title}</Text>}
          renderItem={({ item }) => (
            <PassRow pass={item} now={now} reminded={!!reminderFor(item)} onToggle={() => toggleReminder(item)} />
          )}
          ListEmptyComponent={
            <EmptyState
              icon="moon-outline"
              title={onlyVisual ? 'Sin pases visibles a simple vista' : 'Sin pases en este período'}
              body={
                model.orbit.orbitClass === 'GEO'
                  ? 'Un satélite geoestacionario está siempre en la misma posición del cielo: si no aparece, está bajo tu horizonte.'
                  : 'Probá bajar la elevación mínima en Ajustes o ampliar la cantidad de días.'
              }
            />
          }
          ListFooterComponent={
            upcoming.length > 0 ? (
              <Text style={styles.legend}>
                ✨ visible a simple vista: el satélite está iluminado por el Sol y vos en oscuridad (Sol &lt; −6°). Los demás son pases de radio, válidos para un enlace.
              </Text>
            ) : undefined
          }
        />
      )}
    </View>
  );
}

function PassRow({ pass, now, reminded, onToggle }: { pass: Pass; now: number; reminded: boolean; onToggle: () => void }) {
  const active = pass.aos.time <= now;
  return (
    <Pressable onPress={() => router.push(`/pass/${pass.aos.time}`)} style={({ pressed }) => [styles.row, active && styles.rowActive, pressed && { opacity: 0.75 }]}>
      <View style={styles.timeCol}>
        <Text style={styles.time}>{pass.aosClipped ? 'en curso' : fmtHm(pass.aos.time)}</Text>
        <Text style={styles.small}>{fmtDuration(pass.durationSec)}</Text>
      </View>
      <View style={{ flex: 1, gap: 4 }}>
        <View style={styles.elBarBg}>
          <View style={[styles.elBar, { width: `${Math.max(4, (pass.max.elevation / 90) * 100)}%`, backgroundColor: pass.max.elevation > 45 ? colors.green : pass.max.elevation > 20 ? colors.accent : colors.textDim }]} />
        </View>
        <Text style={styles.small}>
          máx <Text style={styles.strong}>{pass.max.elevation.toFixed(0)}°</Text> a las {fmtHm(pass.max.time)} · {compassPoint(pass.aos.azimuth)} → {compassPoint(pass.los.azimuth)}
          {!active && pass.aos.time - now < 3 * 3_600_000 ? ` · en ${fmtCountdown(pass.aos.time - now)}` : ''}
        </Text>
      </View>
      {pass.visual && <Text style={styles.visual}>✨</Text>}
      <Pressable onPress={onToggle} hitSlop={10} accessibilityLabel={reminded ? 'Cancelar aviso' : 'Programar aviso'}>
        <Ionicons name={reminded ? 'notifications' : 'notifications-outline'} size={22} color={reminded ? colors.amber : colors.textDim} />
      </Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: spacing.lg, gap: 4 },
  title: { color: colors.text, fontSize: 22, fontWeight: '800' },
  sub: { color: colors.textDim, fontSize: 12 },
  perf: { color: colors.green, fontSize: 11, fontFamily: 'monospace' },
  chipsRow: { flexDirection: 'row', marginTop: spacing.sm, flexWrap: 'wrap', rowGap: spacing.sm },
  live: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    margin: spacing.lg,
    marginBottom: 0,
    padding: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.green,
    backgroundColor: 'rgba(61,220,151,0.08)',
  },
  liveTitle: { color: colors.green, fontWeight: '800', fontSize: 13, letterSpacing: 1 },
  liveBody: { color: colors.text, fontSize: 14, marginTop: 2 },
  liveLink: { color: colors.accent, fontSize: 12, marginTop: 4 },
  day: { color: colors.textDim, fontSize: 12, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase', marginTop: spacing.lg, marginBottom: spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  rowActive: { borderColor: colors.green },
  timeCol: { width: 70 },
  time: { color: colors.text, fontSize: 18, fontWeight: '800', fontVariant: ['tabular-nums'] },
  small: { color: colors.textDim, fontSize: 12 },
  strong: { color: colors.text, fontWeight: '700' },
  elBarBg: { height: 6, borderRadius: 3, backgroundColor: colors.surfaceAlt, overflow: 'hidden' },
  elBar: { height: 6, borderRadius: 3 },
  visual: { fontSize: 16 },
  legend: { color: colors.textDim, fontSize: 12, lineHeight: 17, marginTop: spacing.md },
});
