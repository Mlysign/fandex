import { Tabs } from 'expo-router/js-tabs';
import { CalendarDays, LayoutGrid, LibraryBig, Search, UserRound } from 'lucide-react-native';
import { color, font } from '~/theme';

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: color.accent,
        tabBarInactiveTintColor: color.textMuted,
        tabBarStyle: { backgroundColor: color.surfaceElevated, borderTopColor: color.border },
        tabBarLabelStyle: { fontFamily: font.sansBold, fontSize: 11 },
        sceneStyle: { backgroundColor: color.surface },
      }}>
      <Tabs.Screen
        name="index"
        options={{ title: 'Calendar', tabBarIcon: ({ color: c, size }) => <CalendarDays color={c} size={size} /> }}
      />
      <Tabs.Screen
        name="search"
        options={{ title: 'Search', tabBarIcon: ({ color: c, size }) => <Search color={c} size={size} /> }}
      />
      <Tabs.Screen
        name="library"
        options={{ title: 'Library', tabBarIcon: ({ color: c, size }) => <LibraryBig color={c} size={size} /> }}
      />
      <Tabs.Screen
        name="browse"
        options={{ title: 'Browse', tabBarIcon: ({ color: c, size }) => <LayoutGrid color={c} size={size} /> }}
      />
      <Tabs.Screen
        name="you"
        options={{ title: 'You', tabBarIcon: ({ color: c, size }) => <UserRound color={c} size={size} /> }}
      />
    </Tabs>
  );
}
