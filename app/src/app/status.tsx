/**
 * Estado de la Data Provider Layer: circuit breakers, uso de cuota por
 * proveedor (rate limiter) y log en vivo de cada request HTTP.
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { fmtTime, providerLabel } from '../components/format';
import { Card, SectionTitle } from '../components/ui';
import type { ProviderHealth } from '../core/data/repository';
import { proxyConfig, proxyHealth, repository, requestLog } from '../services/dataService';
import { colors, spacing } from '../theme';

const windowLabel = (ms: number) => (ms >= 3_600_000 ? `${ms / 3_600_000} h` : ms >= 60_000 ? `${ms / 60_000} min` : `${ms / 1000} s`);

export default function StatusScreen() {
  const log = useSyncExternalStore((l) => requestLog.subscribe(l), () => requestLog.list());
  // Se recalcula con cada nueva request registrada.
  const health = useMemo<ProviderHealth[]>(() => (log ? repository.health() : []), [log]);
  const [proxy, setProxy] = useState<{ ok: boolean; detail: string } | null>(null);

  useEffect(() => {
    void proxyHealth().then(setProxy);
  }, []);

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm }}>
      <Card>
        <Text style={styles.name}>Proxy de credenciales</Text>
        <Text style={styles.dim}>{proxyConfig.baseUrl ?? 'sin configurar'}</Text>
        <Text style={[styles.dim, { color: proxy?.ok ? colors.green : colors.amber }]}>{proxy ? proxy.detail : 'verificando…'}</Text>
      </Card>

      <SectionTitle>Proveedores (orden de fallback)</SectionTitle>
      {health.map((h, i) => (
        <Card key={h.id}>
          <View style={styles.row}>
            <Text style={styles.name}>
              {i + 1}. {h.label}
            </Text>
            <Text style={[styles.badge, { color: h.circuit === 'closed' ? colors.green : h.circuit === 'open' ? colors.red : colors.amber }]}>
              {h.circuit === 'closed' ? 'OPERATIVO' : h.circuit === 'open' ? 'EN CUARENTENA' : 'PROBANDO'}
            </Text>
          </View>
          {h.usage.map((u) => (
            <View key={u.windowMs} style={{ marginTop: 6 }}>
              <Text style={styles.dim}>
                {u.used}/{u.limit} requests en {windowLabel(u.windowMs)}
              </Text>
              <View style={styles.barBg}>
                <View style={[styles.bar, { width: `${Math.min(100, (u.used / u.limit) * 100)}%`, backgroundColor: u.used / u.limit > 0.8 ? colors.red : colors.accent }]} />
              </View>
            </View>
          ))}
          {h.lastError && <Text style={[styles.dim, { color: colors.amber, marginTop: 6 }]}>Último error: {h.lastError}</Text>}
        </Card>
      ))}

      <SectionTitle>Log de requests ({log.length})</SectionTitle>
      <Card>
        {log.length === 0 && <Text style={styles.dim}>Sin requests todavía: todo se está sirviendo desde la caché local.</Text>}
        {log.map((e) => (
          <View key={e.id} style={styles.logRow}>
            <Text style={[styles.logStatus, { color: e.ok ? colors.green : colors.red }]}>{e.status ?? 'ERR'}</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.logMain} numberOfLines={1}>
                {providerLabel[e.provider]} · {e.operation}
                {e.attempt > 0 ? ` · reintento ${e.attempt}` : ''}
              </Text>
              <Text style={styles.logUrl} numberOfLines={1}>
                {e.url}
              </Text>
              {e.error && <Text style={[styles.logUrl, { color: colors.red }]}>{e.error}</Text>}
            </View>
            <Text style={styles.logTime}>
              {fmtTime(e.startedAt)}
              {'\n'}
              {e.durationMs} ms
            </Text>
          </View>
        ))}
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  name: { color: colors.text, fontSize: 15, fontWeight: '700' },
  badge: { fontSize: 11, fontWeight: '800', letterSpacing: 0.8 },
  dim: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  barBg: { height: 5, backgroundColor: colors.surfaceAlt, borderRadius: 3, marginTop: 3, overflow: 'hidden' },
  bar: { height: 5, borderRadius: 3 },
  logRow: { flexDirection: 'row', gap: spacing.sm, paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  logStatus: { width: 34, fontSize: 12, fontWeight: '800', fontFamily: 'monospace' },
  logMain: { color: colors.text, fontSize: 12, fontWeight: '600' },
  logUrl: { color: colors.textDim, fontSize: 10, fontFamily: 'monospace' },
  logTime: { color: colors.textDim, fontSize: 10, textAlign: 'right' },
});
