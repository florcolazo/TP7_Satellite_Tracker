import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router/js-tabs';
import type { ComponentProps } from 'react';
import type { ColorValue } from 'react-native';
import { colors } from '../../theme';

type IconName = ComponentProps<typeof Ionicons>['name'];

function icon(name: IconName) {
  const TabIcon = ({ color, size }: { color: ColorValue | null; size: number }) => <Ionicons name={name} color={typeof color === 'number' ? undefined : (color ?? undefined)} size={size} />;
  TabIcon.displayName = `TabIcon(${name})`;
  return TabIcon;
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textDim,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Mapa', tabBarIcon: icon('earth') }} />
      <Tabs.Screen name="catalog" options={{ title: 'Catálogo', tabBarIcon: icon('search') }} />
      <Tabs.Screen name="passes" options={{ title: 'Pases', tabBarIcon: icon('time') }} />
      <Tabs.Screen name="compass" options={{ title: 'Brújula', tabBarIcon: icon('compass') }} />
      <Tabs.Screen name="settings" options={{ title: 'Ajustes', tabBarIcon: icon('settings') }} />
    </Tabs>
  );
}
