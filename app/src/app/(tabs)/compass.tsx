/**
 * Modo brújula (RF-07): indica hacia dónde apuntar la parte superior del
 * teléfono para encontrar el satélite.
 *
 *  - Rumbo: Location.watchHeadingAsync → trueHeading (Norte geográfico, ya
 *    corrige la declinación magnética; el azimut de SGP4 también es geográfico).
 *  - Inclinación: DeviceMotion.rotation.beta (0° = teléfono plano, 90° = vertical)
 *    se interpreta como la elevación hacia la que apunta el borde superior.
 *  - Objetivo: posición actual si el satélite está sobre el horizonte; si no,
 *    el punto de AOS del próximo pase ("esperalo acá").
 */
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import { DeviceMotion } from 'expo-sensors';
import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { compassPoint, fmtCountdown, fmtHm } from '../../components/format';
import { SkyChart } from '../../components/SkyChart';
import { EmptyState } from '../../components/ui';
import { toObserverGeodetic } from '../../core/orbital/engine';
import { useNow, usePasses, useSelectedModel } from '../../hooks/useOrbital';
import { useAppState } from '../../state/appStore';
import { colors, radius, spacing } from '../../theme';

const ALIGN_TOLERANCE = 8;

/** Diferencia angular con signo en (-180, 180]. */
const angleDiff = (a: number, b: number) => ((((a - b) % 360) + 540) % 360) - 180;

/** Filtro paso-bajo para ángulos (evita el salto 359°→0°). */
function smoothAngle(prev: number | null, next: number, alpha = 0.2) {
  if (prev === null) return next;
  return (prev + angleDiff(next, prev) * alpha + 360) % 360;
}

function useHeading() {
  const [heading, setHeading] = useState<number | null>(null);
  const [accuracy, setAccuracy] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const last = useRef<number | null>(null);
  useEffect(() => {
    let sub: Location.LocationSubscription | null = null;
    let cancelled = false;
    (async () => {
      const perm = await Location.getForegroundPermissionsAsync();
      if (!perm.granted) {
        const req = await Location.requestForegroundPermissionsAsync();
        if (!req.granted) {
          setError('Sin permiso de ubicación: el rumbo verdadero no está disponible');
        }
      }
      try {
        sub = await Location.watchHeadingAsync((h) => {
          const raw = h.trueHeading >= 0 ? h.trueHeading : h.magHeading;
          last.current = smoothAngle(last.current, raw);
          setHeading(last.current);
          setAccuracy(h.accuracy);
        });
        if (cancelled) sub.remove();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Magnetómetro no disponible');
      }
    })();
    return () => {
      cancelled = true;
      sub?.remove();
    };
  }, []);
  return { heading, accuracy, error };
}

function usePitch() {
  const [pitch, setPitch] = useState<number | null>(null);
  useEffect(() => {
    let sub: { remove: () => void } | null = null;
    DeviceMotion.isAvailableAsync().then((ok) => {
      if (!ok) return;
      DeviceMotion.setUpdateInterval(100);
      let prev: number | null = null;
      sub = DeviceMotion.addListener((m) => {
        if (!m.rotation) return;
        const deg = (m.rotation.beta * 180) / Math.PI;
        prev = prev === null ? deg : prev + (deg - prev) * 0.25;
        setPitch(prev);
      });
    });
    return () => sub?.remove();
  }, []);
  return pitch;
}

export default function CompassScreen() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const model = useSelectedModel();
  const observer = useAppState((s) => s.observer);
  const minElevation = useAppState((s) => s.settings.minElevation);
  const obs = useMemo(() => toObserverGeodetic(observer), [observer]);
  const now = useNow(250);
  const { heading, accuracy, error } = useHeading();
  const pitch = usePitch();
  const { passes } = usePasses(model);
  const wasAligned = useRef(false);

  const look = model?.look(obs, now) ?? null;
  const above = !!look && look.elevation > 0;
  const nextPass = passes.find((p) => p.los.time > now);
  const target = above ? { azimuth: look!.azimuth, elevation: look!.elevation } : nextPass ? { azimuth: nextPass.aos.azimuth, elevation: Math.max(minElevation, nextPass.aos.elevation) } : null;

  const dAz = target && heading !== null ? angleDiff(target.azimuth, heading) : null;
  const dEl = target && pitch !== null ? target.elevation - pitch : null;
  const aligned = dAz !== null && Math.abs(dAz) < ALIGN_TOLERANCE && (dEl === null || Math.abs(dEl) < ALIGN_TOLERANCE);

  useEffect(() => {
    if (aligned && !wasAligned.current) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    wasAligned.current = aligned;
  }, [aligned]);

  if (!model) return <EmptyState icon="compass-outline" title="Elegí un satélite" body="Seleccioná un satélite para apuntarle." />;

  const dial = Math.min(width - spacing.xl * 2, 340);
  const pathSamples = above && nextPass && nextPass.aos.time <= now ? nextPass.samples : nextPass?.samples ?? [];

  return (
    <View style={[styles.root, { paddingTop: insets.top + spacing.md }]}>
      <Text style={styles.title}>{model.name}</Text>
      <Text style={styles.subtitle}>
        {above
          ? `Sobre el horizonte · az ${look!.azimuth.toFixed(0)}° ${compassPoint(look!.azimuth)} · el ${look!.elevation.toFixed(0)}°`
          : nextPass
            ? `Aparece a las ${fmtHm(nextPass.aos.time)} (en ${fmtCountdown(nextPass.aos.time - now)}) por el ${compassPoint(nextPass.aos.azimuth)}`
            : 'Sin pases próximos desde tu ubicación'}
      </Text>

      <View style={[styles.dialWrap, { width: dial, height: dial }]}>
        <View style={[styles.dialBg, { borderColor: aligned ? colors.green : colors.border }]} />
        <SkyChart
          size={dial}
          samples={pathSamples}
          current={target}
          minElevation={minElevation}
          rotation={heading !== null ? -heading : 0}
        />
        {/* Indicador fijo: hacia donde apunta el teléfono */}
        <View style={styles.pointer}>
          <Ionicons name="caret-down" size={28} color={aligned ? colors.green : colors.amber} />
        </View>
      </View>

      <View style={styles.instructions}>
        {target && dAz !== null ? (
          <>
            <Instruction
              icon={Math.abs(dAz) < ALIGN_TOLERANCE ? 'checkmark-circle' : dAz > 0 ? 'arrow-redo' : 'arrow-undo'}
              ok={Math.abs(dAz) < ALIGN_TOLERANCE}
              text={Math.abs(dAz) < ALIGN_TOLERANCE ? 'Dirección correcta' : `Girá ${Math.abs(dAz).toFixed(0)}° a la ${dAz > 0 ? 'derecha' : 'izquierda'}`}
            />
            {dEl !== null && (
              <Instruction
                icon={Math.abs(dEl) < ALIGN_TOLERANCE ? 'checkmark-circle' : dEl > 0 ? 'arrow-up' : 'arrow-down'}
                ok={Math.abs(dEl) < ALIGN_TOLERANCE}
                text={Math.abs(dEl) < ALIGN_TOLERANCE ? 'Inclinación correcta' : `${dEl > 0 ? 'Levantá' : 'Bajá'} el teléfono ${Math.abs(dEl).toFixed(0)}°`}
              />
            )}
          </>
        ) : (
          <Text style={styles.dim}>{error ?? 'Esperando la brújula del dispositivo…'}</Text>
        )}
      </View>

      <View style={styles.footer}>
        <Text style={styles.dim}>
          Rumbo {heading !== null ? `${heading.toFixed(0)}°` : '—'} · inclinación {pitch !== null ? `${pitch.toFixed(0)}°` : '—'}
          {accuracy > 0 && accuracy < 2 ? ' · calibrá la brújula moviendo el teléfono en forma de 8' : ''}
        </Text>
        <Text style={styles.dim}>Apuntá el borde superior del teléfono hacia el cielo.</Text>
      </View>
    </View>
  );
}

function Instruction({ icon, text, ok }: { icon: React.ComponentProps<typeof Ionicons>['name']; text: string; ok: boolean }) {
  return (
    <View style={styles.instruction}>
      <Ionicons name={icon} size={26} color={ok ? colors.green : colors.amber} />
      <Text style={[styles.instructionText, ok && { color: colors.green }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', paddingHorizontal: spacing.lg },
  title: { color: colors.text, fontSize: 22, fontWeight: '800' },
  subtitle: { color: colors.textDim, fontSize: 13, textAlign: 'center', marginTop: 4 },
  dialWrap: { marginTop: spacing.xl, alignItems: 'center', justifyContent: 'center' },
  dialBg: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, borderRadius: 999, borderWidth: 3, backgroundColor: colors.surface },
  pointer: { position: 'absolute', top: -22 },
  instructions: { marginTop: spacing.xl, gap: spacing.sm, alignSelf: 'stretch' },
  instruction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  instructionText: { color: colors.text, fontSize: 17, fontWeight: '700' },
  footer: { position: 'absolute', bottom: spacing.lg, left: spacing.lg, right: spacing.lg, gap: 2 },
  dim: { color: colors.textDim, fontSize: 12, textAlign: 'center' },
});
