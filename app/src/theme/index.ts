/** Paleta "control de misión": fondo espacial, acentos cian/ámbar. */
export const colors = {
  bg: '#070B14',
  surface: '#0F1626',
  surfaceAlt: '#16203A',
  border: '#22304F',
  text: '#E6EDF7',
  textDim: '#8A9BB8',
  accent: '#38D9F5', // satélite seleccionado / trayectoria futura
  accentDim: 'rgba(56,217,245,0.35)',
  amber: '#FFB547', // observador / alertas
  green: '#3DDC97', // visible / OK
  red: '#FF5D73', // error / desactualizado
  violet: '#A78BFA', // constelación
  footprintFill: 'rgba(56,217,245,0.10)',
  footprintStroke: 'rgba(56,217,245,0.65)',
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 };
export const radius = { sm: 6, md: 10, lg: 16, pill: 999 };

export const font = {
  mono: 'monospace',
};

/** Estilo oscuro para Google Maps (Android / Expo Go). */
export const darkMapStyle = [
  { elementType: 'geometry', stylers: [{ color: '#0b1220' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#6b7a99' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#0b1220' }] },
  { featureType: 'administrative.country', elementType: 'geometry.stroke', stylers: [{ color: '#2c3d63' }] },
  { featureType: 'administrative.province', elementType: 'geometry.stroke', stylers: [{ color: '#1c2842' }] },
  { featureType: 'landscape', elementType: 'geometry', stylers: [{ color: '#111a2e' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#050912' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#2c3d63' }] },
];
