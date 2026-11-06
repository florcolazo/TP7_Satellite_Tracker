import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps, ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors, radius, spacing } from '../theme';

export type IconName = ComponentProps<typeof Ionicons>['name'];

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <View style={styles.sectionRow}>
      <Text style={styles.section}>{children}</Text>
      {right}
    </View>
  );
}

export function Chip({
  label,
  active,
  onPress,
  icon,
  color = colors.accent,
}: {
  label: string;
  active?: boolean;
  onPress?: () => void;
  icon?: IconName;
  color?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: !!active }}
      style={({ pressed }) => [
        styles.chip,
        active && { backgroundColor: color + '26', borderColor: color },
        pressed && { opacity: 0.7 },
      ]}
    >
      {icon && <Ionicons name={icon} size={14} color={active ? color : colors.textDim} style={{ marginRight: 4 }} />}
      <Text style={[styles.chipText, active && { color }]}>{label}</Text>
    </Pressable>
  );
}

export function Button({
  label,
  onPress,
  icon,
  variant = 'primary',
  loading,
  disabled,
  style,
}: {
  label: string;
  onPress: () => void;
  icon?: IconName;
  variant?: 'primary' | 'secondary' | 'danger';
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const bg = variant === 'primary' ? colors.accent : variant === 'danger' ? colors.red : colors.surfaceAlt;
  const fg = variant === 'secondary' ? colors.text : colors.bg;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      style={({ pressed }) => [styles.button, { backgroundColor: bg, opacity: disabled ? 0.4 : pressed ? 0.8 : 1 }, style]}
    >
      {loading ? (
        <ActivityIndicator color={fg} size="small" />
      ) : (
        icon && <Ionicons name={icon} size={18} color={fg} style={{ marginRight: 6 }} />
      )}
      <Text style={[styles.buttonText, { color: fg }]}>{label}</Text>
    </Pressable>
  );
}

export function Stat({ label, value, unit, color }: { label: string; value: string; unit?: string; color?: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, color ? { color } : null]}>
        {value}
        {unit ? <Text style={styles.statUnit}> {unit}</Text> : null}
      </Text>
    </View>
  );
}

export function Stepper({
  label,
  value,
  onChange,
  step = 1,
  min,
  max,
  unit,
  hint,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min: number;
  max: number;
  unit?: string;
  hint?: string;
}) {
  const set = (v: number) => onChange(Math.min(max, Math.max(min, v)));
  return (
    <View style={styles.stepperRow}>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowLabel}>{label}</Text>
        {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      </View>
      <Pressable accessibilityLabel={`Disminuir ${label}`} onPress={() => set(value - step)} style={styles.stepBtn} hitSlop={8}>
        <Ionicons name="remove" size={18} color={colors.text} />
      </Pressable>
      <Text style={styles.stepValue}>
        {value}
        {unit}
      </Text>
      <Pressable accessibilityLabel={`Aumentar ${label}`} onPress={() => set(value + step)} style={styles.stepBtn} hitSlop={8}>
        <Ionicons name="add" size={18} color={colors.text} />
      </Pressable>
    </View>
  );
}

export function EmptyState({ icon, title, body, action }: { icon: IconName; title: string; body?: string; action?: ReactNode }) {
  return (
    <View style={styles.empty}>
      <Ionicons name={icon} size={44} color={colors.textDim} />
      <Text style={styles.emptyTitle}>{title}</Text>
      {body ? <Text style={styles.emptyBody}>{body}</Text> : null}
      {action}
    </View>
  );
}

export const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.lg, marginBottom: spacing.sm },
  section: { color: colors.textDim, fontSize: 12, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    marginRight: spacing.sm,
  },
  chipText: { color: colors.textDim, fontSize: 13, fontWeight: '600' },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: 12,
    borderRadius: radius.md,
  },
  buttonText: { fontWeight: '700', fontSize: 15 },
  stat: { minWidth: 70 },
  statLabel: { color: colors.textDim, fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.6 },
  statValue: { color: colors.text, fontSize: 17, fontWeight: '700', fontVariant: ['tabular-nums'], marginTop: 2 },
  statUnit: { color: colors.textDim, fontSize: 12, fontWeight: '500' },
  stepperRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm },
  rowLabel: { color: colors.text, fontSize: 15, fontWeight: '600' },
  hint: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  stepBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepValue: { color: colors.text, fontSize: 16, fontWeight: '700', minWidth: 64, textAlign: 'center', fontVariant: ['tabular-nums'] },
  empty: { alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.sm },
  emptyTitle: { color: colors.text, fontSize: 17, fontWeight: '700', textAlign: 'center' },
  emptyBody: { color: colors.textDim, fontSize: 14, textAlign: 'center', lineHeight: 20 },
});
