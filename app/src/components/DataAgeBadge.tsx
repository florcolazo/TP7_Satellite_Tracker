/**
 * RF-16: antigüedad de los elementos orbitales.
 *
 * El error de SGP4 crece con la distancia temporal a la época del set
 * (≈ 1-3 km/día en LEO por la incertidumbre del arrastre atmosférico).
 * Umbrales: < 1 día OK · 1-3 días aceptable · > 3 días desactualizado.
 */
import { Ionicons } from '@expo/vector-icons';
import { Alert, Pressable, StyleSheet, Text } from 'react-native';
import { colors, radius } from '../theme';
import { fmtAge, providerLabel } from './format';
import type { OrbitalRecord } from '../core/types';

export function ageLevel(hours: number): 'ok' | 'warn' | 'stale' {
  if (hours < 24) return 'ok';
  if (hours < 72) return 'warn';
  return 'stale';
}

export function DataAgeBadge({ record, now }: { record: OrbitalRecord; now: number }) {
  const hours = (now - record.epoch) / 3_600_000;
  const level = ageLevel(hours);
  const color = level === 'ok' ? colors.green : level === 'warn' ? colors.amber : colors.red;
  const icon = level === 'stale' ? 'warning' : 'time-outline';

  const explain = () =>
    Alert.alert(
      level === 'stale' ? 'Datos orbitales desactualizados' : 'Antigüedad de los datos',
      `Época de los elementos: ${new Date(record.epoch).toLocaleString('es-AR')}\n` +
        `Antigüedad: ${fmtAge(hours)}\n` +
        `Fuente: ${providerLabel[record.source]}${record.dataset === 'supgp' ? ' (SupGP, efemérides del operador)' : ''}\n` +
        `Descargado: ${new Date(record.fetchedAt).toLocaleString('es-AR')}\n\n` +
        (level === 'stale'
          ? 'El error de posición de SGP4 crece varios km por día. Actualizá los datos desde Ajustes o conectate a internet.'
          : 'El error esperado de SGP4 con esta antigüedad es de pocos km.'),
    );

  return (
    <Pressable onPress={explain} style={[styles.badge, { borderColor: color }]} accessibilityRole="button" accessibilityLabel={`Datos de hace ${fmtAge(hours)}`}>
      <Ionicons name={icon} size={12} color={color} />
      <Text style={[styles.text, { color }]}>TLE {fmtAge(hours)}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  text: { fontSize: 11, fontWeight: '700' },
});
