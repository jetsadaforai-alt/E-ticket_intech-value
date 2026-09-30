import AsyncStorage from '@react-native-async-storage/async-storage';

// Kept out of api/client.ts on purpose — the token lives there because apiRequest
// needs it inline, but the app mode has no HTTP role at all.
const MODE_KEY = 'eticket_app_mode';

export type AppMode = 'customer' | 'vendor' | 'staff';

const VALID: AppMode[] = ['customer', 'vendor', 'staff'];

export async function loadStoredMode(): Promise<AppMode | null> {
  const raw = await AsyncStorage.getItem(MODE_KEY);
  return raw && VALID.includes(raw as AppMode) ? (raw as AppMode) : null;
}

export async function storeMode(mode: AppMode | null): Promise<void> {
  if (mode) await AsyncStorage.setItem(MODE_KEY, mode);
  else await AsyncStorage.removeItem(MODE_KEY);
}
