/**
 * Modo validación (RF-15): compara la posición SGP4 local contra N2YO
 * (cualquier satélite, vía proxy) y Where the ISS at? (ISS) y muestra el
 * error en km. El historial se guarda para armar el informe de validación.
 */
import { useEffect, useMemo, useState } from 'react';
import { Alert, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { fmtAge, fmtTime, providerLabel } from '../components/format';
import { Button, Card, SectionTitle } from '../components/ui';
import { toObserverGeodetic } from '../core/orbital/engine';
import type { WhereTheIssProvider } from '../core/data/providers/WhereTheIssProvider';
import { ISS_NORAD_ID } from '../core/data/providers/WhereTheIssProvider';
import type { ProviderId } from '../core/types';
import { compareWithReference, errorStats, type ValidationSample } from '../core/validation/compare';
import { useSelectedModel } from '../hooks/useOrbital';
import { proxyConfig, repository } from '../services/dataService';
import { loadJsonRaw, saveJson } from '../services/kv';
import { useAppState } from '../state/appStore';
import { colors, spacing } from '../theme';

const HISTORY_KEY = 'validation-history-v1';

interface Row {
  provider: ProviderId;
  noradId: number;
  name: string;
  timestamp: number;
  groundErrorKm: number;
  altitudeErrorKm: number;
  totalErrorKm: number;
  dataAgeHours: number;
  azimuthErrorDeg?: number;
  elevationErrorDeg?: number;
}

const toRow = (s: ValidationSample, name: string): Row => ({
  provider: s.provider,
  noradId: s.noradId,
  name,
  timestamp: s.timestamp,
  groundErrorKm: s.groundErrorKm,
  altitudeErrorKm: s.altitudeErrorKm,
  totalErrorKm: s.totalErrorKm,
  dataAgeHours: s.dataAgeHours,
  azimuthErrorDeg: s.azimuthErrorDeg,
  elevationErrorDeg: s.elevationErrorDeg,
});

export default function ValidationScreen() {
  const model = useSelectedModel();
  const observer = useAppState((s) => s.observer);
  const obs = useMemo(() => toObserverGeodetic(observer), [observer]);
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState<'now' | 'series' | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => {
    loadJsonRaw<Row[]>(HISTORY_KEY).then((h) => h && setRows(h));
  }, []);

  const addRows = (newRows: Row[]) => {
    setRows((prev) => {
      const next = [...newRows, ...prev].slice(0, 200);
      void saveJson(HISTORY_KEY, next);
      return next;
    });
  };

  const compareNow = async () => {
    if (!model) return;
    setBusy('now');
    setErrors([]);
    try {
      const outcomes = await repository.validate(model.noradId, observer);
      const errs: string[] = [];
      const fresh: Row[] = [];
      for (const o of outcomes) {
        if (o.position) {
          const s = compareWithReference(model, o.position, obs);
          if (s) fresh.push(toRow(s, model.name));
        } else errs.push(`${o.label}: ${o.error}`);
      }
      if (outcomes.length === 0) {
        errs.push(
          model.noradId === ISS_NORAD_ID
            ? 'No hay fuentes de validación disponibles.'
            : `Para satélites distintos de la ISS se necesita N2YO a través del proxy${proxyConfig.baseUrl ? '' : ' (EXPO_PUBLIC_PROXY_URL no configurado)'}.`,
        );
      }
      addRows(fresh);
      setErrors(errs);
    } finally {
      setBusy(null);
    }
  };

  /** Serie temporal contra Where the ISS at?: 10 instantes de −12 h a +12 h. */
  const series = async () => {
    if (!model || model.noradId !== ISS_NORAD_ID) return;
    setBusy('series');
    try {
      const wtia = repository.provider<WhereTheIssProvider>('wheretheiss')!;
      const now = Date.now();
      const ts = Array.from({ length: 10 }, (_, i) => now + (i - 5) * 2.4 * 3_600_000);
      const refs = await wtia.getPositionsAt(ts);
      addRows(refs.map((r) => compareWithReference(model, r, obs)).filter((s): s is ValidationSample => !!s).map((s) => toRow(s, model.name)));
    } catch (e) {
      setErrors([e instanceof Error ? e.message : String(e)]);
    } finally {
      setBusy(null);
    }
  };

  const exportCsv = async () => {
    const header = 'timestamp_utc,fuente,norad,satelite,error_horizontal_km,error_altitud_km,error_3d_km,antiguedad_tle_h,error_az_deg,error_el_deg';
    const lines = rows.map((r) =>
      [
        new Date(r.timestamp).toISOString(),
        r.provider,
        r.noradId,
        `"${r.name}"`,
        r.groundErrorKm.toFixed(4),
        r.altitudeErrorKm.toFixed(4),
        r.totalErrorKm.toFixed(4),
        r.dataAgeHours.toFixed(2),
        r.azimuthErrorDeg?.toFixed(3) ?? '',
        r.elevationErrorDeg?.toFixed(3) ?? '',
      ].join(','),
    );
    await Share.share({ title: 'validacion.csv', message: [header, ...lines].join('\n') });
  };

  const clear = () =>
    Alert.alert('Borrar historial', '¿Eliminar todas las mediciones?', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Borrar', style: 'destructive', onPress: () => (setRows([]), void saveJson(HISTORY_KEY, [])) },
    ]);

  const byProvider = (['wheretheiss', 'n2yo'] as ProviderId[]).map((p) => ({ p, stats: errorStats(rows.filter((r) => r.provider === p)) }));

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
      <Card>
        <Text style={styles.title}>{model?.name ?? 'Sin satélite'}</Text>
        <Text style={styles.body}>
          Se calcula la posición con SGP4 en el MISMO instante que informa la fuente externa, para que la latencia de red no afecte la
          medición. Error 3D = distancia entre ambas posiciones en coordenadas ECEF (WGS-84).
        </Text>
        <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
          <Button label="Comparar ahora" icon="git-compare" onPress={compareNow} loading={busy === 'now'} disabled={!model} style={{ flex: 1 }} />
          {model?.noradId === ISS_NORAD_ID && (
            <Button label="Serie ±12 h" icon="stats-chart" variant="secondary" onPress={series} loading={busy === 'series'} style={{ flex: 1 }} />
          )}
        </View>
        {errors.map((e) => (
          <Text key={e} style={styles.error}>
            {e}
          </Text>
        ))}
      </Card>

      <SectionTitle>Resumen por fuente</SectionTitle>
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        {byProvider.map(({ p, stats }) => (
          <Card key={p} style={{ flex: 1 }}>
            <Text style={styles.cardLabel}>{providerLabel[p]}</Text>
            {stats.count ? (
              <>
                <Text style={styles.big}>{stats.meanKm < 1 ? `${(stats.meanKm * 1000).toFixed(0)} m` : `${stats.meanKm.toFixed(2)} km`}</Text>
                <Text style={styles.small}>
                  error medio · RMS {stats.rmsKm.toFixed(3)} km · máx {stats.maxKm.toFixed(3)} km · n={stats.count}
                </Text>
              </>
            ) : (
              <Text style={styles.small}>Sin mediciones</Text>
            )}
          </Card>
        ))}
      </View>

      <SectionTitle
        right={
          rows.length > 0 ? (
            <View style={{ flexDirection: 'row', gap: spacing.md }}>
              <Text style={styles.link} onPress={exportCsv}>
                Exportar CSV
              </Text>
              <Text style={[styles.link, { color: colors.red }]} onPress={clear}>
                Borrar
              </Text>
            </View>
          ) : null
        }
      >
        Mediciones
      </SectionTitle>
      <Card>
        <View style={styles.tr}>
          <Text style={[styles.th, { flex: 1.3, textAlign: 'left' }]}>Hora · fuente</Text>
          <Text style={styles.th}>Horiz.</Text>
          <Text style={styles.th}>Alt.</Text>
          <Text style={styles.th}>3D</Text>
          <Text style={styles.th}>TLE</Text>
        </View>
        {rows.length === 0 && <Text style={styles.small}>Todavía no hay mediciones.</Text>}
        {rows.slice(0, 60).map((r, i) => (
          <View key={`${r.timestamp}-${r.provider}-${i}`} style={styles.tr}>
            <View style={{ flex: 1.3 }}>
              <Text style={styles.td}>{fmtTime(r.timestamp)}</Text>
              <Text style={styles.tdDim}>
                {providerLabel[r.provider]} · {r.name.slice(0, 12)}
              </Text>
            </View>
            <Text style={styles.tdNum}>{r.groundErrorKm.toFixed(3)}</Text>
            <Text style={styles.tdNum}>{r.altitudeErrorKm.toFixed(3)}</Text>
            <Text style={[styles.tdNum, { color: r.totalErrorKm < 1 ? colors.green : r.totalErrorKm < 10 ? colors.amber : colors.red }]}>
              {r.totalErrorKm.toFixed(3)}
            </Text>
            <Text style={styles.tdNum}>{fmtAge(r.dataAgeHours)}</Text>
          </View>
        ))}
        <Text style={styles.small}>Valores en km. TLE = antigüedad de nuestros elementos orbitales en el instante medido.</Text>
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  title: { color: colors.text, fontSize: 18, fontWeight: '800' },
  body: { color: colors.textDim, fontSize: 13, lineHeight: 19, marginTop: spacing.sm },
  error: { color: colors.red, fontSize: 12, marginTop: spacing.sm },
  cardLabel: { color: colors.textDim, fontSize: 12, fontWeight: '700' },
  big: { color: colors.green, fontSize: 24, fontWeight: '800', marginTop: 4 },
  small: { color: colors.textDim, fontSize: 11, marginTop: 4, lineHeight: 15 },
  link: { color: colors.accent, fontSize: 13, fontWeight: '700' },
  tr: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  th: { color: colors.textDim, fontSize: 10, fontWeight: '700', textTransform: 'uppercase', flex: 1, textAlign: 'right' },
  td: { color: colors.text, fontSize: 12, fontVariant: ['tabular-nums'] },
  tdDim: { color: colors.textDim, fontSize: 10 },
  tdNum: { color: colors.text, fontSize: 12, flex: 1, textAlign: 'right', fontVariant: ['tabular-nums'] },
});
