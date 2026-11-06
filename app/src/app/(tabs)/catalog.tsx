/**
 * Catálogo (RF-01, RF-08): búsqueda por nombre o NORAD ID y filtro por
 * constelación. Busca primero en la caché SQLite; si no encuentra, consulta
 * online (CelesTrak por nombre / cadena de fallback por NORAD ID).
 */
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { memo, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fmtAge, providerLabel } from '../../components/format';
import { Chip } from '../../components/ui';
import { CATALOG_GROUPS } from '../../core/data/groups';
import type { GroupMeta } from '../../core/data/store';
import { SatelliteModel } from '../../core/orbital/engine';
import type { CatalogGroup, OrbitalRecord } from '../../core/types';
import { repository } from '../../services/dataService';
import { markGroupUsed, setState, useAppState } from '../../state/appStore';
import { useNow } from '../../hooks/useOrbital';
import { colors, radius, spacing } from '../../theme';

const FEATURED: { id: number; name: string; why: string }[] = [
  { id: 25544, name: 'ISS (ZARYA)', why: 'Estación Espacial Internacional · LEO 420 km' },
  { id: 48274, name: 'CSS (TIANHE)', why: 'Estación espacial china · LEO' },
  { id: 20580, name: 'HST', why: 'Telescopio Hubble · LEO 520 km' },
  { id: 33591, name: 'NOAA 19', why: 'Meteorológico polar · APT 137.1 MHz' },
  { id: 41866, name: 'GOES 16', why: 'Meteorológico geoestacionario · GEO' },
  { id: 48859, name: 'NAVSTAR 81', why: 'GPS III · MEO 20 200 km' },
  { id: 27424, name: 'AQUA', why: 'Observación terrestre (NASA) · LEO' },
];

export default function CatalogScreen() {
  const insets = useSafeAreaInsets();
  const selected = useAppState((s) => s.selected);
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [group, setGroup] = useState<CatalogGroup | null>(null);
  // Resultados asíncronos "etiquetados" con la consulta que los produjo:
  // si la etiqueta no coincide con la consulta actual, todavía está cargando.
  const [groupState, setGroupState] = useState<{ group: CatalogGroup; meta: (GroupMeta & { stale?: boolean }) | null; error?: string } | null>(null);
  const [search, setSearch] = useState<{ key: string; results: OrbitalRecord[]; error?: string } | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const [opening, setOpening] = useState<number | null>(null);
  const now = useNow(60_000);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(query), 300);
    return () => clearTimeout(id);
  }, [query]);

  // Al elegir un grupo, asegurar que esté descargado (respetando TTL/caché).
  useEffect(() => {
    if (!group) return;
    let cancelled = false;
    repository
      .getGroup(group, { limit: 1 })
      .then(async (r) => {
        if (cancelled) return;
        markGroupUsed(group);
        const m = await repository.groupMeta(group);
        setGroupState({ group, meta: m ? { ...m, stale: r.stale } : null });
      })
      .catch((e) => !cancelled && setGroupState({ group, meta: null, error: e instanceof Error ? e.message : String(e) }));
    return () => {
      cancelled = true;
    };
  }, [group]);

  const current = group && groupState?.group === group ? groupState : null;
  const meta = current?.meta ?? null;
  const searchKey = `${debounced}|${group ?? ''}|${meta?.fetchedAt ?? ''}`;
  const groupReady = !group || !!current;

  useEffect(() => {
    if ((!debounced && !group) || !groupReady) return;
    let cancelled = false;
    repository
      .search(debounced, group, 300)
      .then((results) => !cancelled && setSearch({ key: searchKey, results }))
      .catch((e) => !cancelled && setSearch({ key: searchKey, results: [], error: e instanceof Error ? e.message : String(e) }));
    return () => {
      cancelled = true;
    };
  }, [debounced, group, groupReady, searchKey]);

  const active = !!debounced || !!group;
  const results = active && search?.key === searchKey ? search.results : [];
  const loading = (!!group && !current) || (active && search?.key !== searchKey);
  const error = openError ?? current?.error ?? (search?.key === searchKey ? search.error : undefined) ?? null;

  const select = (rec: OrbitalRecord) => {
    setState({ selected: rec });
    router.navigate('/');
  };

  const openFeatured = async (id: number) => {
    setOpening(id);
    setOpenError(null);
    try {
      select((await repository.getSatellite(id)).data);
    } catch (e) {
      setOpenError(e instanceof Error ? e.message : String(e));
    } finally {
      setOpening(null);
    }
  };

  const showFeatured = !debounced && !group;

  return (
    <View style={[styles.root, { paddingTop: insets.top + spacing.sm }]}>
      <View style={styles.searchBox}>
        <Ionicons name="search" size={18} color={colors.textDim} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Nombre o NORAD ID (ej. NOAA, 25544)"
          placeholderTextColor={colors.textDim}
          style={styles.input}
          autoCapitalize="characters"
          autoCorrect={false}
          returnKeyType="search"
          clearButtonMode="while-editing"
        />
        {loading && <ActivityIndicator size="small" color={colors.accent} />}
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips} contentContainerStyle={{ paddingHorizontal: spacing.lg }}>
        <Chip label="Todos" active={group === null} onPress={() => setGroup(null)} />
        {CATALOG_GROUPS.map((g) => (
          <Chip key={g.id} label={g.label} active={group === g.id} onPress={() => setGroup(g.id)} />
        ))}
      </ScrollView>

      {group && meta && (
        <Text style={[styles.meta, meta.stale && { color: colors.red }]}>
          {meta.count} objetos · {providerLabel[meta.source]}
          {meta.dataset === 'supgp' ? ' SupGP (efemérides del operador)' : ''} · actualizado hace {fmtAge((now - meta.fetchedAt) / 3_600_000)}
          {meta.stale ? ' · SIN CONEXIÓN, datos en caché vencidos' : ''}
        </Text>
      )}
      {error && <Text style={styles.error}>{error}</Text>}

      {showFeatured ? (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm }}>
          <Text style={styles.sectionTitle}>Destacados</Text>
          {FEATURED.map((f) => (
            <Pressable key={f.id} onPress={() => openFeatured(f.id)} style={({ pressed }) => [styles.item, pressed && { opacity: 0.7 }]}>
              <View style={{ flex: 1 }}>
                <Text style={styles.itemName}>{f.name}</Text>
                <Text style={styles.itemMeta}>
                  NORAD {f.id} · {f.why}
                </Text>
              </View>
              {opening === f.id ? <ActivityIndicator color={colors.accent} /> : <Ionicons name="chevron-forward" size={18} color={colors.textDim} />}
            </Pressable>
          ))}
          <Text style={styles.hint}>
            Elegí una constelación arriba para explorar el catálogo completo. Los datos se guardan en el teléfono y se renuevan cada{' '}
            {Math.round(repository.ttl / 3_600_000)} h para respetar los límites de cada API.
          </Text>
        </ScrollView>
      ) : (
        <FlatList
          data={results}
          keyExtractor={(r) => String(r.noradId)}
          renderItem={({ item }) => <Row rec={item} active={item.noradId === selected?.noradId} onPress={select} />}
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm }}
          initialNumToRender={20}
          windowSize={7}
          ListEmptyComponent={
            !loading ? <Text style={styles.hint}>{debounced ? `Sin resultados para "${debounced}"` : 'Sin datos para este grupo'}</Text> : undefined
          }
        />
      )}
    </View>
  );
}

const Row = memo(function Row({ rec, active, onPress }: { rec: OrbitalRecord; active: boolean; onPress: (r: OrbitalRecord) => void }) {
  const info = useMemo(() => {
    try {
      return new SatelliteModel(rec).orbit;
    } catch {
      return null;
    }
  }, [rec]);
  return (
    <Pressable onPress={() => onPress(rec)} style={({ pressed }) => [styles.item, active && styles.itemActive, pressed && { opacity: 0.7 }]}>
      <View style={{ flex: 1 }}>
        <Text style={styles.itemName} numberOfLines={1}>
          {rec.name}
        </Text>
        <Text style={styles.itemMeta}>
          NORAD {rec.noradId}
          {info ? ` · ${info.orbitClass} · ${Math.round((info.perigeeKm + info.apogeeKm) / 2).toLocaleString('es-AR')} km · ${info.inclinationDeg.toFixed(1)}°` : ' · elementos inválidos'}
        </Text>
      </View>
      {info && (
        <View style={[styles.classPill, { borderColor: classColor[info.orbitClass] }]}>
          <Text style={[styles.classText, { color: classColor[info.orbitClass] }]}>{info.orbitClass}</Text>
        </View>
      )}
    </Pressable>
  );
});

const classColor = { LEO: colors.accent, MEO: colors.green, GEO: colors.amber, HEO: colors.violet };

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  input: { flex: 1, color: colors.text, fontSize: 15, paddingVertical: 12 },
  chips: { flexGrow: 0, marginTop: spacing.md },
  meta: { color: colors.textDim, fontSize: 12, marginHorizontal: spacing.lg, marginTop: spacing.sm },
  error: { color: colors.red, fontSize: 12, marginHorizontal: spacing.lg, marginTop: spacing.sm },
  sectionTitle: { color: colors.textDim, fontSize: 12, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase' },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  itemActive: { borderColor: colors.accent },
  itemName: { color: colors.text, fontSize: 15, fontWeight: '700' },
  itemMeta: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  classPill: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2 },
  classText: { fontSize: 11, fontWeight: '800' },
  hint: { color: colors.textDim, fontSize: 13, lineHeight: 19, marginTop: spacing.md, textAlign: 'center' },
});
