/**
 * Almacenamiento clave-valor persistente (preferencias, selección, historial).
 * expo-sqlite/kv-store expone la API de AsyncStorage sobre SQLite.
 */
import Storage from 'expo-sqlite/kv-store';

export async function loadJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await Storage.getItem(key);
    return raw ? ({ ...fallback, ...JSON.parse(raw) } as T) : fallback;
  } catch {
    return fallback;
  }
}

export async function loadJsonRaw<T>(key: string): Promise<T | null> {
  try {
    const raw = await Storage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export async function saveJson(key: string, value: unknown): Promise<void> {
  try {
    await Storage.setItem(key, JSON.stringify(value));
  } catch {
    // Persistencia best-effort: un fallo de escritura no debe romper la UI.
  }
}
