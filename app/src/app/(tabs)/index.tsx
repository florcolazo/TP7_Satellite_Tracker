/**
 * Mapa mundial (RF-10 a RF-13): posición en tiempo real, ground track,
 * footprint y capa de constelación. Todo se calcula localmente con SGP4;
 * la red sólo se usa para bajar elementos orbitales (con caché).
 */
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, Polygon, Polyline, PROVIDER_GOOGLE, type Region } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DataAgeBadge } from '../../components/DataAgeBadge';
import { compassPoint, fmtCountdown, fmtLat, fmtLon } from '../../components/format';
import { Chip, Stat } from '../../components/ui';
import { groupDef } from '../../core/data/groups';
import { clusterPoints } from '../../core/orbital/constellation';
import { toObserverGeodetic } from '../../core/orbital/engine';
import { footprintGeometry, footprintPolygons } from '../../core/orbital/footprint';
import { computeGroundTrack } from '../../core/orbital/groundTrack';
import { useConstellation } from '../../hooks/useConstellation';
import { useNow, usePasses, useSelectedModel } from '../../hooks/useOrbital';
import { updateSettings, useAppState } from '../../state/appStore';
import { colors, darkMapStyle, radius, spacing } from '../../theme';

const WORLD: Region = { latitude: -10, longitude: -50, latitudeDelta: 120, longitudeDelta: 160 };

/** Las vistas custom de Marker en Android necesitan unos frames con tracksViewChanges para dibujarse. */
function useInitialTracking(dep: string | number | undefined, ms = 800) {
  const [settled, setSettled] = useState<typeof dep | null>(null);
  useEffect(() => {
    const id = setTimeout(() => setSettled(dep), ms);
    return () => clearTimeout(id);
  }, [dep, ms]);
  return settled !== dep;
}

export default function MapScreen() {
  const insets = useSafeAreaInsets();
  const mapRef = useRef<MapView>(null);
  const model = useSelectedModel();
  const record = useAppState((s) => s.selected);
  const observer = useAppState((s) => s.observer);
  const settings = useAppState((s) => s.settings);
  const [region, setRegion] = useState<Region>(WORLD);
  const [follow, setFollow] = useState(false);

  // Refresco a 2 Hz: posición exacta de SGP4 en cada tick (no interpolada).
  const now = useNow(500);
  const obsGeo = useMemo(() => toObserverGeodetic(observer), [observer]);
  const pos = model?.position(now) ?? null;
  const look = model && pos ? model.look(obsGeo, now) : null;

  // Ground track: se recalcula cada minuto (una órbita a paso 30-60 s ≈ 150 puntos).
  const minute = Math.floor(now / 60_000);
  const track = useMemo(
    () => (model && settings.showGroundTrack ? computeGroundTrack(model, minute * 60_000) : null),
    [model, settings.showGroundTrack, minute],
  );

  // Footprint: cada 2 s alcanza (en 2 s la ISS avanza ~15 km sobre un radio de ~1500 km).
  const twoSec = Math.floor(now / 2000);
  const footprint = useMemo(() => {
    if (!model || !settings.showFootprint) return null;
    const p = model.position(twoSec * 2000);
    if (!p) return null;
    const geo = footprintGeometry(p.altitudeKm, settings.minElevation);
    return { geo, polygons: footprintPolygons(p, geo.centralAngleDeg) };
  }, [model, settings.showFootprint, settings.minElevation, twoSec]);

  const { points, status: constStatus } = useConstellation(settings.showConstellation, settings.constellationGroup, settings.constellationLimit);
  const clusters = useMemo(() => clusterPoints(points, region, 9), [points, region]);

  const { passes } = usePasses(model);
  const nextPass = passes.find((p) => p.los.time > now);

  const satTracking = useInitialTracking(record?.noradId);
  const clusterTracking = useInitialTracking(clusters.length);

  // Modo seguimiento: centrar la cámara en el satélite cada 2 s.
  const followLat = pos ? Math.round(pos.latitude * 10) / 10 : null;
  const followLon = pos ? Math.round(pos.longitude * 10) / 10 : null;
  useEffect(() => {
    if (follow && followLat !== null && followLon !== null) {
      mapRef.current?.animateCamera({ center: { latitude: followLat, longitude: followLon } }, { duration: 400 });
    }
  }, [follow, followLat, followLon, twoSec]);

  const visibleNow = look && look.elevation >= settings.minElevation;

  return (
    <View style={styles.root}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
        customMapStyle={darkMapStyle}
        userInterfaceStyle="dark"
        initialRegion={WORLD}
        onRegionChangeComplete={setRegion}
        onPanDrag={() => follow && setFollow(false)}
        rotateEnabled={false}
        pitchEnabled={false}
        toolbarEnabled={false}
        moveOnMarkerPress={false}
      >
        {footprint?.polygons.map((poly, i) => (
          <Polygon key={`fp-${i}`} coordinates={poly} fillColor={colors.footprintFill} strokeColor={colors.footprintStroke} strokeWidth={1.5} />
        ))}

        {track?.past.map((seg, i) => (
          <Polyline key={`past-${i}`} coordinates={seg} strokeColor="rgba(138,155,184,0.55)" strokeWidth={2} lineDashPattern={[6, 6]} />
        ))}
        {track?.future.map((seg, i) => (
          <Polyline key={`fut-${i}`} coordinates={seg} strokeColor={colors.accent} strokeWidth={2.5} />
        ))}

        {settings.showConstellation &&
          clusters.map((c) =>
            c.single ? (
              <Marker
                key={`c-${c.key}`}
                coordinate={c}
                anchor={{ x: 0.5, y: 0.5 }}
                tracksViewChanges={clusterTracking}
                title={c.single.name}
                description={`NORAD ${c.single.noradId} · ${c.single.altitudeKm.toFixed(0)} km`}
              >
                <View style={styles.constDot} />
              </Marker>
            ) : (
              <Marker key={`c-${c.key}-${c.count}`} coordinate={c} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={clusterTracking}>
                <View style={[styles.cluster, { width: 22 + Math.min(18, c.count / 3), height: 22 + Math.min(18, c.count / 3) }]}>
                  <Text style={styles.clusterText}>{c.count}</Text>
                </View>
              </Marker>
            ),
          )}

        <Marker coordinate={observer} anchor={{ x: 0.5, y: 0.5 }} title="Tu ubicación" tracksViewChanges={false}>
          <View style={styles.observer} />
        </Marker>

        {pos && record && (
          <Marker
            key={`sat-${record.noradId}`}
            coordinate={{ latitude: pos.latitude, longitude: pos.longitude }}
            anchor={{ x: 0.5, y: 0.5 }}
            tracksViewChanges={satTracking}
            title={record.name}
            zIndex={10}
          >
            <View style={styles.satHalo}>
              <View style={styles.satCore}>
                <Ionicons name="planet" size={14} color={colors.bg} />
              </View>
            </View>
          </Marker>
        )}
      </MapView>

      {/* Capas */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={[styles.layers, { top: insets.top + spacing.sm }]} contentContainerStyle={{ paddingHorizontal: spacing.md }}>
        <Chip label="Ground track" icon="analytics" active={settings.showGroundTrack} onPress={() => updateSettings({ showGroundTrack: !settings.showGroundTrack })} />
        <Chip label={`Footprint ${settings.minElevation}°`} icon="radio-outline" active={settings.showFootprint} onPress={() => updateSettings({ showFootprint: !settings.showFootprint })} />
        <Chip
          label={
            settings.showConstellation && constStatus.shown
              ? `${groupDef(settings.constellationGroup).label} ${constStatus.shown}/${constStatus.total.toLocaleString('es-AR')}`
              : 'Constelación'
          }
          icon="grid-outline"
          color={colors.violet}
          active={settings.showConstellation}
          onPress={() => updateSettings({ showConstellation: !settings.showConstellation })}
        />
        <Chip label="Seguir" icon="locate" active={follow} onPress={() => setFollow((f) => !f)} />
      </ScrollView>

      {settings.showConstellation && (constStatus.loading || constStatus.error) && (
        <View style={[styles.toast, { top: insets.top + 56 }]}>
          <Text style={styles.toastText}>{constStatus.loading ? 'Descargando constelación…' : `Constelación: ${constStatus.error}`}</Text>
        </View>
      )}

      {/* Tarjeta de información */}
      <View style={styles.cardWrap} pointerEvents="box-none">
        {record && model && pos ? (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.satName} numberOfLines={1}>
                  {record.name}
                </Text>
                <Text style={styles.satMeta}>
                  NORAD {record.noradId} · {model.orbit.orbitClass} · {model.orbit.periodMin.toFixed(1)} min · {model.orbit.inclinationDeg.toFixed(1)}°
                </Text>
              </View>
              <DataAgeBadge record={record} now={now} />
            </View>

            <View style={styles.statsRow}>
              <Stat label="Lat" value={fmtLat(pos.latitude)} />
              <Stat label="Lon" value={fmtLon(pos.longitude)} />
              <Stat label="Alt" value={pos.altitudeKm.toFixed(1)} unit="km" />
              <Stat label="Vel" value={pos.velocityKmS.toFixed(2)} unit="km/s" />
            </View>

            {look && (
              <View style={styles.statsRow}>
                <Stat label="Azimut" value={`${look.azimuth.toFixed(1)}° ${compassPoint(look.azimuth)}`} />
                <Stat label="Elevación" value={`${look.elevation.toFixed(1)}°`} color={visibleNow ? colors.green : colors.textDim} />
                <Stat label="Rango" value={look.rangeKm.toFixed(0)} unit="km" />
                {footprint && <Stat label="Cobertura" value={(footprint.geo.groundRadiusKm * 2).toFixed(0)} unit="km Ø" />}
              </View>
            )}

            <View style={styles.footerRow}>
              <Ionicons name={visibleNow ? 'eye' : 'time-outline'} size={16} color={visibleNow ? colors.green : colors.amber} />
              <Text style={styles.footerText}>
                {visibleNow
                  ? `Sobre tu horizonte ahora · termina en ${nextPass ? fmtCountdown(nextPass.los.time - now) : '—'}`
                  : nextPass
                    ? `Próximo pase en ${fmtCountdown(nextPass.aos.time - now)} · máx ${nextPass.max.elevation.toFixed(0)}°${nextPass.visual ? ' · visible ✨' : ''}`
                    : 'Sin pases en los próximos días'}
              </Text>
            </View>

            <View style={styles.actions}>
              <Action icon="time" label="Pases" onPress={() => router.navigate('/passes')} />
              <Action icon="compass" label="Apuntar" onPress={() => router.navigate('/compass')} />
              <Action icon="checkmark-done" label="Validar" onPress={() => router.push('/validation')} />
              <Action icon="search" label="Cambiar" onPress={() => router.navigate('/catalog')} />
            </View>
          </View>
        ) : (
          <View style={styles.card}>
            <Text style={styles.satName}>Cargando satélite…</Text>
            <Text style={styles.satMeta}>Descargando elementos orbitales de la ISS desde CelesTrak</Text>
          </View>
        )}
      </View>
    </View>
  );
}

function Action({ icon, label, onPress }: { icon: React.ComponentProps<typeof Ionicons>['name']; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.action, pressed && { opacity: 0.6 }]} accessibilityRole="button">
      <Ionicons name={icon} size={20} color={colors.accent} />
      <Text style={styles.actionText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  layers: { position: 'absolute', left: 0, right: 0, flexGrow: 0 },
  toast: {
    position: 'absolute',
    alignSelf: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: colors.border,
  },
  toastText: { color: colors.text, fontSize: 12 },
  satHalo: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(56,217,245,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  satCore: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#fff',
  },
  observer: { width: 14, height: 14, borderRadius: 7, backgroundColor: colors.amber, borderWidth: 2, borderColor: '#fff' },
  constDot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: colors.violet, borderWidth: 1, borderColor: 'rgba(255,255,255,0.6)' },
  cluster: {
    borderRadius: 999,
    backgroundColor: 'rgba(167,139,250,0.35)',
    borderWidth: 1.5,
    borderColor: colors.violet,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clusterText: { color: '#fff', fontSize: 10, fontWeight: '800' },
  cardWrap: { position: 'absolute', left: spacing.md, right: spacing.md, bottom: spacing.md },
  card: {
    backgroundColor: 'rgba(15,22,38,0.94)',
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.md,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  satName: { color: colors.text, fontSize: 19, fontWeight: '800' },
  satMeta: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  statsRow: { flexDirection: 'row', justifyContent: 'space-between' },
  footerRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  footerText: { color: colors.text, fontSize: 13, flex: 1 },
  actions: { flexDirection: 'row', justifyContent: 'space-around', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingTop: spacing.sm },
  action: { alignItems: 'center', gap: 2, paddingHorizontal: spacing.sm },
  actionText: { color: colors.textDim, fontSize: 11, fontWeight: '600' },
});
