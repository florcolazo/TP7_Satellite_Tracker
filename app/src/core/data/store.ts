/**
 * Persistencia local de datos orbitales. La app usa SQLite (SqliteOrbitalStore
 * en src/services) porque el set de Starlink son >10 000 objetos y supera el
 * límite de ~6 MB de AsyncStorage en Android. Los tests usan la versión en
 * memoria, que implementa exactamente el mismo contrato.
 */
import type { CatalogGroup, OrbitalRecord, ProviderId } from '../types';

export interface GroupMeta {
  group: CatalogGroup;
  fetchedAt: number;
  source: ProviderId;
  dataset?: string;
  count: number;
}

export interface OrbitalStore {
  saveGroup(group: CatalogGroup, records: OrbitalRecord[], meta: GroupMeta): Promise<void>;
  loadGroup(group: CatalogGroup, limit?: number): Promise<OrbitalRecord[] | null>;
  groupMeta(group: CatalogGroup): Promise<GroupMeta | null>;
  allGroupMeta(): Promise<GroupMeta[]>;
  /** Marca un grupo como verificado ahora sin cambiar sus datos (respuesta "not modified"). */
  touchGroup(group: CatalogGroup, fetchedAt: number): Promise<void>;
  save(record: OrbitalRecord): Promise<void>;
  load(noradId: number): Promise<OrbitalRecord | null>;
  /** Búsqueda por nombre (substring, sin distinguir mayúsculas) o NORAD ID exacto. */
  search(query: string, group: CatalogGroup | null, limit: number): Promise<OrbitalRecord[]>;
}

export class MemoryOrbitalStore implements OrbitalStore {
  private records = new Map<number, OrbitalRecord>();
  private groups = new Map<CatalogGroup, { ids: number[]; meta: GroupMeta }>();

  async saveGroup(group: CatalogGroup, records: OrbitalRecord[], meta: GroupMeta) {
    for (const r of records) this.records.set(r.noradId, r);
    this.groups.set(group, { ids: records.map((r) => r.noradId), meta });
  }

  async loadGroup(group: CatalogGroup, limit?: number) {
    const g = this.groups.get(group);
    if (!g) return null;
    const ids = limit ? g.ids.slice(0, limit) : g.ids;
    return ids.map((id) => this.records.get(id)).filter((r): r is OrbitalRecord => !!r);
  }

  async groupMeta(group: CatalogGroup) {
    return this.groups.get(group)?.meta ?? null;
  }

  async allGroupMeta() {
    return [...this.groups.values()].map((g) => g.meta);
  }

  async touchGroup(group: CatalogGroup, fetchedAt: number) {
    const g = this.groups.get(group);
    if (g) g.meta = { ...g.meta, fetchedAt };
  }

  async save(record: OrbitalRecord) {
    this.records.set(record.noradId, record);
  }

  async load(noradId: number) {
    return this.records.get(noradId) ?? null;
  }

  async search(query: string, group: CatalogGroup | null, limit: number) {
    const q = query.trim().toUpperCase();
    const pool = group ? ((await this.loadGroup(group)) ?? []) : [...this.records.values()];
    const asId = /^\d+$/.test(q) ? Number(q) : null;
    return pool
      .filter((r) => (asId !== null ? r.noradId === asId : r.name.toUpperCase().includes(q)))
      .slice(0, limit);
  }
}
