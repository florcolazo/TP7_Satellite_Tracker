import type { CatalogGroup } from '../types';

export interface GroupDefinition {
  id: CatalogGroup;
  label: string;
  description: string;
  /** Query GP de CelesTrak (parámetro GROUP). */
  celestrakGroup: string;
  /** Archivo SupGP (datos suplementarios derivados de efemérides del operador). */
  celestrakSupGp?: string;
}

/** Constelaciones/categorías del catálogo (RF-08). */
export const CATALOG_GROUPS: GroupDefinition[] = [
  { id: 'stations', label: 'Estaciones', description: 'ISS, Tiangong y módulos tripulados', celestrakGroup: 'stations' },
  {
    id: 'starlink',
    label: 'Starlink',
    description: 'Constelación de SpaceX (SupGP: efemérides del operador)',
    celestrakGroup: 'starlink',
    celestrakSupGp: 'starlink',
  },
  { id: 'gps', label: 'GPS', description: 'Constelación NAVSTAR operativa (MEO)', celestrakGroup: 'gps-ops' },
  { id: 'weather', label: 'Meteorológicos', description: 'NOAA, METEOR, GOES, Meteosat…', celestrakGroup: 'weather' },
  { id: 'geo', label: 'Geoestacionarios', description: 'Satélites GEO activos (comunicaciones/TV)', celestrakGroup: 'geo' },
  { id: 'amateur', label: 'Radioaficionados', description: 'Satélites de radio amateur', celestrakGroup: 'amateur' },
  { id: 'visual', label: 'Más brillantes', description: 'Los ~100 objetos más visibles a simple vista', celestrakGroup: 'visual' },
  { id: 'science', label: 'Científicos', description: 'Hubble y otras misiones científicas', celestrakGroup: 'science' },
];

export function groupDef(id: CatalogGroup): GroupDefinition {
  const g = CATALOG_GROUPS.find((x) => x.id === id);
  if (!g) throw new Error(`Grupo desconocido: ${id}`);
  return g;
}
