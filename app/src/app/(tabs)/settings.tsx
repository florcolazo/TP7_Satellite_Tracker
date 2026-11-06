import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fmtAge, fmtDay, fmtHm, fmtLat, fmtLon, providerLabel } from '../../components/format';
import { Button, Card, Chip, SectionTitle, Stepper } from '../../components/ui';
import { CATALOG_GROUPS, groupDef } from '../../core/data/groups';
import type { GroupMeta } from '../../core/data/store';
import { lastBackgroundRun, runBackgroundRefresh, type BackgroundRunReport } from '../../services/background';
import { refreshAll, startGpsObserver } from '../../services/bootstrap';
import { repository } from '../../services/dataService';
import { cancelReminder } from '../../services/notifications';
import { setState, updateSettings, useAppState } from '../../state/appStore';
import { useNow } from '../../hooks/useOrbital';
import { colors, radius, spacing } from '../../theme';

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const settings = useAppState((s) => s.settings);
  const observer = useAppState((s) => s.observer);
  const source = useAppState((s) => s.observerSource);
  const reminders = useAppState((s) => s.reminders);
  const watched = useAppState((s) => s.watched);
  const [metas, setMetas] = useState<GroupMeta[]>([]);
  const [bg, setBg] = useState<BackgroundRunReport | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [lat, setLat] = useState('');
  const [lon, setLon] = useState('');
  const now = useNow(60_000);

  const reload = useCallback(() => {
    void repository.allGroupMeta().then(setMetas);
    void lastBackgroundRun().then(setBg);
  }, []);
  useFocusEffect(reload);

  const saveManual = () => {
    const la = Number(lat.replace(',', '.'));
    const lo = Number(lon.replace(',', '.'));
    if (!Number.isFinite(la) || !Number.isFinite(lo) || Math.abs(la) > 90 || Math.abs(lo) > 180) {
      Alert.alert('Coordenadas inválidas', 'Latitud entre −90 y 90, longitud entre −180 y 180 (grados decimales).');
      return;
    }
    const o = { latitude: la, longitude: lo, altitudeKm: 0 };
    updateSettings({ manualObserver: o });
    setState({ observer: o, observerSource: 'manual' });
  };

  const useGps = async () => {
    updateSettings({ manualObserver: null });
    setBusy('gps');
    await startGpsObserver();
    setBusy(null);
  };

  const refresh = async () => {
    setBusy('refresh');
    try {
      const r = await refreshAll(true);
      Alert.alert('Datos actualizados', r);
    } finally {
      setBusy(null);
      reload();
    }
  };

  const runBg = async () => {
    setBusy('bg');
    const r = await runBackgroundRefresh();
    setBg(r);
    setBusy(null);
  };

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.lg, paddingTop: insets.top + spacing.md, paddingBottom: 48 }}>
      <Text style={styles.h1}>Ajustes</Text>

      <SectionTitle>Estación terrena (observador)</SectionTitle>
      <Card>
        <Text style={styles.value}>
          {fmtLat(observer.latitude)}, {fmtLon(observer.longitude)} · {(observer.altitudeKm * 1000).toFixed(0)} m
        </Text>
        <Text style={styles.hint}>
          Fuente: {source === 'gps' ? 'GPS del dispositivo' : source === 'manual' ? 'ubicación manual' : 'por defecto (FCyT-UADER, Concepción del Uruguay)'}
        </Text>
        <View style={styles.inputs}>
          <TextInput style={styles.input} placeholder="Latitud" placeholderTextColor={colors.textDim} keyboardType="numbers-and-punctuation" value={lat} onChangeText={setLat} />
          <TextInput style={styles.input} placeholder="Longitud" placeholderTextColor={colors.textDim} keyboardType="numbers-and-punctuation" value={lon} onChangeText={setLon} />
        </View>
        <View style={styles.buttons}>
          <Button label="Fijar manual" variant="secondary" icon="pin" onPress={saveManual} style={{ flex: 1 }} />
          <Button label="Usar GPS" variant="secondary" icon="navigate" onPress={useGps} loading={busy === 'gps'} style={{ flex: 1 }} />
        </View>
      </Card>

      <SectionTitle>Predicción y enlace</SectionTitle>
      <Card>
        <Stepper
          label="Elevación mínima"
          hint="Umbral de pases y del footprint (ITU-R: 5-10° típico; Starlink usa ~25°)"
          value={settings.minElevation}
          min={0}
          max={45}
          step={5}
          unit="°"
          onChange={(v) => updateSettings({ minElevation: v })}
        />
        <Stepper label="Días a predecir" value={settings.passDays} min={1} max={7} unit=" d" onChange={(v) => updateSettings({ passDays: v })} />
        <Stepper
          label="Aviso previo"
          hint="Minutos antes del AOS"
          value={settings.notifyLeadMin}
          min={1}
          max={60}
          step={settings.notifyLeadMin < 5 ? 1 : 5}
          unit=" min"
          onChange={(v) => updateSettings({ notifyLeadMin: v })}
        />
      </Card>

      <SectionTitle>Capa de constelación</SectionTitle>
      <Card>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: spacing.sm }}>
          {CATALOG_GROUPS.filter((g) => ['starlink', 'gps', 'geo', 'weather', 'amateur', 'visual'].includes(g.id)).map((g) => (
            <Chip key={g.id} label={g.label} color={colors.violet} active={settings.constellationGroup === g.id} onPress={() => updateSettings({ constellationGroup: g.id })} />
          ))}
        </ScrollView>
        <Stepper
          label="Máximo de satélites"
          hint="Submuestreo uniforme del catálogo + agrupamiento por zoom"
          value={settings.constellationLimit}
          min={50}
          max={2000}
          step={50}
          onChange={(v) => updateSettings({ constellationLimit: v })}
        />
        <View style={styles.switchRow}>
          <Text style={styles.label}>Mostrar en el mapa</Text>
          <Switch value={settings.showConstellation} onValueChange={(v) => updateSettings({ showConstellation: v })} trackColor={{ true: colors.violet }} />
        </View>
      </Card>

      <SectionTitle>Datos orbitales</SectionTitle>
      <Card>
        <Stepper
          label="TTL de caché"
          hint="Se vuelven a descargar al vencer (CelesTrak publica 1-2 veces por día)"
          value={settings.ttlHours}
          min={12}
          max={24}
          step={2}
          unit=" h"
          onChange={(v) => {
            updateSettings({ ttlHours: v });
            repository.setTtl(v * 3_600_000);
          }}
        />
        {metas.map((m) => {
          const ageH = (now - m.fetchedAt) / 3_600_000;
          const stale = ageH * 3_600_000 > repository.ttl;
          return (
            <View key={m.group} style={styles.metaRow}>
              <Ionicons name={stale ? 'alert-circle' : 'checkmark-circle'} size={16} color={stale ? colors.amber : colors.green} />
              <Text style={styles.metaText}>
                {groupDef(m.group).label}: {m.count.toLocaleString('es-AR')} obj · {providerLabel[m.source]}
                {m.dataset === 'supgp' ? ' SupGP' : ''} · hace {fmtAge(ageH)}
              </Text>
            </View>
          );
        })}
        <View style={styles.buttons}>
          <Button label="Actualizar ahora" icon="cloud-download" onPress={refresh} loading={busy === 'refresh'} style={{ flex: 1 }} />
          <Button label="Proveedores" icon="pulse" variant="secondary" onPress={() => router.push('/status')} style={{ flex: 1 }} />
        </View>
      </Card>

      <SectionTitle>Segundo plano y avisos</SectionTitle>
      <Card>
        <Text style={styles.hint}>
          Cada ~1 h (según el sistema operativo) la app refresca datos vencidos y reprograma los avisos de {watched.length} satélite(s) vigilado(s).
        </Text>
        <Text style={[styles.value, { marginTop: spacing.sm }]}>
          Última ejecución: {bg ? `${fmtDay(bg.at)} ${fmtHm(bg.at)} · ${bg.error ? `error: ${bg.error}` : `${bg.refreshed.length} grupos, ${bg.scheduled} avisos`}` : 'nunca'}
        </Text>
        <Button label="Ejecutar ahora" icon="refresh" variant="secondary" onPress={runBg} loading={busy === 'bg'} style={{ marginTop: spacing.sm }} />
        {reminders.length > 0 && <Text style={[styles.label, { marginTop: spacing.md }]}>Avisos programados</Text>}
        {reminders
          .slice()
          .sort((a, b) => a.fireAt - b.fireAt)
          .map((r) => (
            <View key={r.id} style={styles.metaRow}>
              <Ionicons name="notifications" size={16} color={colors.amber} />
              <Text style={styles.metaText}>
                {r.satName} · {fmtDay(r.aos)} {fmtHm(r.aos)} · máx {r.maxElevation.toFixed(0)}°
              </Text>
              <Pressable
                hitSlop={8}
                onPress={async () => {
                  await cancelReminder(r.id);
                  setState((s) => ({ reminders: s.reminders.filter((x) => x.id !== r.id) }));
                }}
              >
                <Ionicons name="close-circle" size={18} color={colors.textDim} />
              </Pressable>
            </View>
          ))}
      </Card>

      <SectionTitle>Calidad</SectionTitle>
      <Card>
        <Pressable onPress={() => router.push('/validation')} style={styles.linkRow}>
          <Ionicons name="checkmark-done" size={20} color={colors.accent} />
          <Text style={[styles.label, { flex: 1 }]}>Validación contra N2YO / Where the ISS at?</Text>
          <Ionicons name="chevron-forward" size={18} color={colors.textDim} />
        </Pressable>
      </Card>

      <Text style={styles.about}>
        Satellite Tracker · TP N° 7 · Programación Móviles 2026{'\n'}LSI · FCyT-UADER · SGP4/SDP4 vía satellite.js
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  h1: { color: colors.text, fontSize: 28, fontWeight: '800' },
  value: { color: colors.text, fontSize: 14, fontWeight: '600' },
  label: { color: colors.text, fontSize: 15, fontWeight: '600' },
  hint: { color: colors.textDim, fontSize: 12, lineHeight: 17, marginTop: 2 },
  inputs: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  input: {
    flex: 1,
    color: colors.text,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    fontSize: 14,
  },
  buttons: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.sm },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
  metaText: { color: colors.textDim, fontSize: 12, flex: 1 },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  about: { color: colors.textDim, fontSize: 11, textAlign: 'center', marginTop: spacing.xl, lineHeight: 16 },
});
