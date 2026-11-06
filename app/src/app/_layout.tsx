// La tarea en background debe definirse en el ámbito global del bundle.
import '../services/background';

import { DarkTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { bootstrap } from '../services/bootstrap';
import { colors } from '../theme';

const theme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: colors.bg, card: colors.surface, text: colors.text, border: colors.border, primary: colors.accent },
};

export default function RootLayout() {
  useEffect(() => {
    void bootstrap();
  }, []);

  return (
    <ThemeProvider value={theme}>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.surface },
          headerTintColor: colors.text,
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="pass/[aos]" options={{ title: 'Pase' }} />
        <Stack.Screen name="validation" options={{ title: 'Validación (RF-15)' }} />
        <Stack.Screen name="status" options={{ title: 'Proveedores de datos' }} />
      </Stack>
    </ThemeProvider>
  );
}
