/**
 * Detalle de un pase: sky chart polar (RF-05), tabla AOS/MAX/LOS y parámetros
 * del enlace (rango, pérdida de espacio libre y Doppler).
 */
import { Stack, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { compassPoint, fmtCountdown, fmtDay, fmtDuration, fmtTime } from '../../components/format';
import { SkyChart } from '../../components/SkyChart';
import { Card, Chip, EmptyState, SectionTitle } from '../../components/ui';
import { toObserverGeodetic } from '../../core/orbital/engine';
import { linkAt } from '../../core/prediction/link';
import { useNow, useSelectedModel } from '../../hooks/useOrbital';
import { useAppState } from '../../state/appStore';
import { getCachedPass } from '../../state/passCache';
import { colors, spacing } from '../../theme';

const BANDS = [
  { label: 'VHF 145.8', mhz: 145.8 },
  { label: 'UHF 437', mhz: 437 },
  { label: 'L 1575', mhz: 1575.42 },
  { label: 'Ku 12 000', mhz: 12_000 },
];

export default function PassDetail() {
  const { aos } = useLocalSearchParams<{ aos: string }>();
  const model = useSelectedModel();
  const observer = useAppState((s) => s.observer);
  const minElevation = useAppState((s) => s.settings.minElevation);
  const obs = useMemo(() => toObserverGeodetic(observer), [observer]);
  const { width } = useWindowDimensions();
  const now = useNow(1000);
  const [band, setBand] = useState(BANDS[0]);

  const pass = model ? getCachedPass(model.noradId, Number(aos)) : undefined;
  const link = useMemo(() => {
    if (!model || !pass) return [];
    return [
      linkAt(model, obs, 'AOS', pass.aos.time, band.mhz),
      linkAt(model, obs, 'MÁX', pass.max.time, band.mhz),
      linkAt(model, obs, 'LOS', pass.los.time, band.mhz),
    ].filter((x) => x !== null);
  }, [model, pass, obs, band]);

  if (!model || !pass) return <EmptyState icon="alert-circle-outline" title="Pase no disponible" body="Volvé a la lista de pases para recalcularlo." />;

  const inProgress = now >= pass.aos.time && now <= pass.los.time;
  const current = inProgress ? model.look(obs, now) : null;
  const size = Math.min(width - spacing.lg * 2, 380);
  const status = inProgress ? `En curso · termina en ${fmtCountdown(pass.los.time - now)}` : now < pass.aos.time ? `Empieza en ${fmtCountdown(pass.aos.time - now)}` : 'Finalizado';

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.lg }}>
      <Stack.Screen options={{ title: `${model.name} · ${fmtDay(pass.aos.time)}` }} />
      <Text style={[styles.status, { color: inProgress ? colors.green : colors.amber }]}>{status}</Text>

      <View style={{ alignItems: 'center', marginVertical: spacing.md }}>
        <SkyChart size={size} samples={pass.samples} current={current} minElevation={minElevation} />
      </View>
      <View style={styles.legendRow}>
        <Legend color={colors.green} label="AOS" />
        <Legend color={colors.text} label="Máximo" />
        <Legend color={colors.red} label="LOS" />
        <Legend color={colors.amber} label="Iluminado" />
        <Legend color={colors.accent} label="En sombra" />
      </View>

      <Card style={{ marginTop: spacing.lg }}>
        <Row label="Duración" value={fmtDuration(pass.durationSec)} />
        <Row label="Visibilidad" value={pass.visual ? 'A simple vista ✨' : 'Sólo radio (no visible)'} />
        {(pass.aosClipped || pass.losClipped) && <Row label="Nota" value="Pase continuo/recortado por la ventana de búsqueda" />}
        <View style={styles.tableHead}>
          <Text style={[styles.th, { flex: 1 }]}>Evento</Text>
          <Text style={styles.th}>Hora</Text>
          <Text style={styles.th}>Azimut</Text>
          <Text style={styles.th}>Elev.</Text>
        </View>
        {[
          ['AOS', pass.aos],
          ['MÁX', pass.max],
          ['LOS', pass.los],
        ].map(([label, p]) => {
          const pt = p as typeof pass.aos;
          return (
            <View key={label as string} style={styles.tr}>
              <Text style={[styles.td, { flex: 1, fontWeight: '800' }]}>{label as string}</Text>
              <Text style={styles.td}>{fmtTime(pt.time)}</Text>
              <Text style={styles.td}>
                {pt.azimuth.toFixed(0)}° {compassPoint(pt.azimuth)}
              </Text>
              <Text style={styles.td}>{pt.elevation.toFixed(1)}°</Text>
            </View>
          );
        })}
      </Card>

      <SectionTitle>Enlace satelital</SectionTitle>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: spacing.sm, marginBottom: spacing.sm }}>
        {BANDS.map((b) => (
          <Chip key={b.label} label={`${b.label} MHz`} active={band === b} onPress={() => setBand(b)} />
        ))}
      </View>
      <Card>
        <View style={styles.tableHead}>
          <Text style={[styles.th, { flex: 1 }]}> </Text>
          <Text style={styles.th}>Rango</Text>
          <Text style={styles.th}>FSPL</Text>
          <Text style={styles.th}>Doppler</Text>
        </View>
        {link.map((l) => (
          <View key={l.label} style={styles.tr}>
            <Text style={[styles.td, { flex: 1, fontWeight: '800' }]}>{l.label}</Text>
            <Text style={styles.td}>{l.rangeKm.toFixed(0)} km</Text>
            <Text style={styles.td}>{l.fsplDb.toFixed(1)} dB</Text>
            <Text style={styles.td}>
              {l.dopplerHz >= 0 ? '+' : '−'}
              {Math.abs(l.dopplerHz / 1000).toFixed(2)} kHz
            </Text>
          </View>
        ))}
        <Text style={styles.note}>
          La pérdida de espacio libre varía ~{link.length === 3 ? (link[0].fsplDb - link[1].fsplDb).toFixed(1) : '—'} dB entre el horizonte y el máximo: por eso
          los enlaces LEO definen una elevación mínima de operación. El Doppler cambia de signo en el punto de máximo acercamiento.
        </Text>
      </Card>
    </ScrollView>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color }} />
      <Text style={{ color: colors.textDim, fontSize: 11 }}>{label}</Text>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.kv}>
      <Text style={styles.k}>{label}</Text>
      <Text style={styles.v}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  status: { fontSize: 14, fontWeight: '700', textAlign: 'center' },
  legendRow: { flexDirection: 'row', justifyContent: 'center', flexWrap: 'wrap', gap: spacing.md },
  kv: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  k: { color: colors.textDim, fontSize: 14 },
  v: { color: colors.text, fontSize: 14, fontWeight: '600' },
  tableHead: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, paddingVertical: 6, marginTop: spacing.sm },
  th: { color: colors.textDim, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', width: 78, textAlign: 'right' },
  tr: { flexDirection: 'row', paddingVertical: 6 },
  td: { color: colors.text, fontSize: 13, width: 78, textAlign: 'right', fontVariant: ['tabular-nums'] },
  note: { color: colors.textDim, fontSize: 12, lineHeight: 17, marginTop: spacing.sm },
});
