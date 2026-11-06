/**
 * Implementación SQLite de OrbitalStore.
 *
 *   orbital(norad_id PK, name, object_id, elements JSON, epoch, source, dataset, fetched_at)
 *   group_member(grp, norad_id, ord)      ← pertenencia a catálogos (RF-08)
 *   group_meta(grp PK, fetched_at, source, dataset, count)  ← TTL por catálogo (RF-09)
 *
 * Insertar ~11 000 satélites Starlink se hace en UNA transacción con
 * inserciones multi-fila de a 100 (≈ 220 llamadas al puente nativo).
 */
import * as SQLite from 'expo-sqlite';
import type { GroupMeta, OrbitalStore } from '../core/data/store';
import type { CatalogGroup, OrbitalRecord, ProviderId } from '../core/types';

interface Row {
  norad_id: number;
  name: string;
  object_id: string | null;
  elements: string;
  epoch: number;
  source: string;
  dataset: string | null;
  fetched_at: number;
}

const SCHEMA = `
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS orbital (
  norad_id INTEGER PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  object_id TEXT,
  elements TEXT NOT NULL,
  epoch INTEGER NOT NULL,
  source TEXT NOT NULL,
  dataset TEXT,
  fetched_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_orbital_name ON orbital(name COLLATE NOCASE);
CREATE TABLE IF NOT EXISTS group_member (
  grp TEXT NOT NULL,
  norad_id INTEGER NOT NULL,
  ord INTEGER NOT NULL,
  PRIMARY KEY (grp, norad_id)
);
CREATE TABLE IF NOT EXISTS group_meta (
  grp TEXT PRIMARY KEY NOT NULL,
  fetched_at INTEGER NOT NULL,
  source TEXT NOT NULL,
  dataset TEXT,
  count INTEGER NOT NULL
);
`;

const UPSERT = `INSERT INTO orbital (norad_id, name, object_id, elements, epoch, source, dataset, fetched_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(norad_id) DO UPDATE SET name=excluded.name, object_id=excluded.object_id, elements=excluded.elements,
  epoch=excluded.epoch, source=excluded.source, dataset=excluded.dataset, fetched_at=excluded.fetched_at`;

/** Filas por sentencia: 100 × 8 parámetros = 800, muy por debajo del límite de SQLite. */
const CHUNK = 100;

function toRecord(r: Row): OrbitalRecord {
  return {
    noradId: r.norad_id,
    name: r.name,
    objectId: r.object_id ?? undefined,
    elements: JSON.parse(r.elements),
    epoch: r.epoch,
    source: r.source as ProviderId,
    dataset: r.dataset ?? undefined,
    fetchedAt: r.fetched_at,
  };
}

function params(r: OrbitalRecord) {
  return [r.noradId, r.name, r.objectId ?? null, JSON.stringify(r.elements), r.epoch, r.source, r.dataset ?? null, r.fetchedAt];
}

export class SqliteOrbitalStore implements OrbitalStore {
  private dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

  private db() {
    if (!this.dbPromise) {
      this.dbPromise = (async () => {
        const db = await SQLite.openDatabaseAsync('orbital.db');
        await db.execAsync(SCHEMA);
        return db;
      })();
    }
    return this.dbPromise;
  }

  async saveGroup(group: CatalogGroup, records: OrbitalRecord[], meta: GroupMeta) {
    const db = await this.db();
    await db.withTransactionAsync(async () => {
      await db.runAsync('DELETE FROM group_member WHERE grp = ?', group);
      // Inserciones multi-fila: ~100× menos llamadas al puente nativo que fila por fila.
      for (let i = 0; i < records.length; i += CHUNK) {
        const chunk = records.slice(i, i + CHUNK);
        await db.runAsync(
          UPSERT.replace('VALUES (?, ?, ?, ?, ?, ?, ?, ?)', `VALUES ${chunk.map(() => '(?, ?, ?, ?, ?, ?, ?, ?)').join(', ')}`),
          chunk.flatMap(params),
        );
        await db.runAsync(
          `INSERT OR REPLACE INTO group_member (grp, norad_id, ord) VALUES ${chunk.map(() => '(?, ?, ?)').join(', ')}`,
          chunk.flatMap((r, j) => [group, r.noradId, i + j]),
        );
      }
      await db.runAsync(
        'INSERT OR REPLACE INTO group_meta (grp, fetched_at, source, dataset, count) VALUES (?, ?, ?, ?, ?)',
        group, meta.fetchedAt, meta.source, meta.dataset ?? null, meta.count,
      );
    });
  }

  async loadGroup(group: CatalogGroup, limit?: number) {
    const db = await this.db();
    const meta = await this.groupMeta(group);
    if (!meta) return null;
    const rows = await db.getAllAsync<Row>(
      `SELECT o.* FROM group_member g JOIN orbital o ON o.norad_id = g.norad_id WHERE g.grp = ? ORDER BY g.ord LIMIT ?`,
      group, limit ?? -1,
    );
    return rows.map(toRecord);
  }

  async groupMeta(group: CatalogGroup) {
    const db = await this.db();
    const r = await db.getFirstAsync<{ grp: string; fetched_at: number; source: string; dataset: string | null; count: number }>(
      'SELECT * FROM group_meta WHERE grp = ?', group,
    );
    return r ? { group: r.grp as CatalogGroup, fetchedAt: r.fetched_at, source: r.source as ProviderId, dataset: r.dataset ?? undefined, count: r.count } : null;
  }

  async allGroupMeta() {
    const db = await this.db();
    const rows = await db.getAllAsync<{ grp: string; fetched_at: number; source: string; dataset: string | null; count: number }>('SELECT * FROM group_meta');
    return rows.map((r) => ({ group: r.grp as CatalogGroup, fetchedAt: r.fetched_at, source: r.source as ProviderId, dataset: r.dataset ?? undefined, count: r.count }));
  }

  async touchGroup(group: CatalogGroup, fetchedAt: number) {
    const db = await this.db();
    await db.runAsync('UPDATE group_meta SET fetched_at = ? WHERE grp = ?', fetchedAt, group);
  }

  async save(record: OrbitalRecord) {
    const db = await this.db();
    await db.runAsync(UPSERT, params(record));
  }

  async load(noradId: number) {
    const db = await this.db();
    const r = await db.getFirstAsync<Row>('SELECT * FROM orbital WHERE norad_id = ?', noradId);
    return r ? toRecord(r) : null;
  }

  async search(query: string, group: CatalogGroup | null, limit: number) {
    const db = await this.db();
    const q = query.trim();
    const isId = /^\d+$/.test(q);
    const where = isId ? 'o.norad_id = ?' : 'o.name LIKE ? COLLATE NOCASE';
    const arg = isId ? Number(q) : `%${q}%`;
    const rows = group
      ? await db.getAllAsync<Row>(
          `SELECT o.* FROM group_member g JOIN orbital o ON o.norad_id = g.norad_id WHERE g.grp = ? AND ${where} ORDER BY g.ord LIMIT ?`,
          group, arg, limit,
        )
      : await db.getAllAsync<Row>(`SELECT o.* FROM orbital o WHERE ${where} ORDER BY o.name LIMIT ?`, arg, limit);
    return rows.map(toRecord);
  }
}
