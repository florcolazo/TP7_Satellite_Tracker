import type { ExpoConfig } from 'expo/config';

/**
 * Configuración de Expo. Las claves NO se versionan:
 *  - GOOGLE_MAPS_API_KEY: necesaria sólo para builds standalone de Android (APK).
 *    En Expo Go el mapa funciona sin clave.
 *  - EXPO_PUBLIC_PROXY_URL: URL del backend proxy (server/) que guarda las
 *    credenciales de Space-Track y N2YO. No es un secreto.
 */
const config: ExpoConfig = {
  name: 'Satellite Tracker',
  slug: 'satellite-tracker',
  scheme: 'satellitetracker',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'dark',
  backgroundColor: '#070B14',
  ios: {
    supportsTablet: true,
    bundleIdentifier: 'ar.edu.uader.fcyt.satellitetracker',
    infoPlist: {
      NSLocationWhenInUseUsageDescription: 'Tu ubicación es la estación terrena: se usa para calcular azimut, elevación y pases.',
    },
  },
  android: {
    package: 'ar.edu.uader.fcyt.satellitetracker',
    adaptiveIcon: {
      backgroundColor: '#070B14',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    permissions: ['ACCESS_COARSE_LOCATION', 'ACCESS_FINE_LOCATION', 'POST_NOTIFICATIONS', 'SCHEDULE_EXACT_ALARM'],
    predictiveBackGestureEnabled: false,
  },
  web: { favicon: './assets/favicon.png' },
  plugins: [
    'expo-router',
    'expo-status-bar',
    'expo-background-task',
    'expo-sqlite',
    [
      'expo-location',
      { locationWhenInUsePermission: 'Tu ubicación es la estación terrena: se usa para calcular azimut, elevación y pases.' },
    ],
    ['expo-notifications', { color: '#38D9F5' }],
    ['react-native-maps', { androidGoogleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY ?? '' }],
  ],
  experiments: { typedRoutes: true },
};

export default config;
