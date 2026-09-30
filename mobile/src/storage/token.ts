import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

// The JWT is a 7-day bearer credential, so it belongs in the OS keychain/keystore
// rather than AsyncStorage's plaintext store. Kept next to appMode.ts, which stays on
// AsyncStorage on purpose — the app mode isn't a secret and doesn't need the ceremony.
const TOKEN_KEY = 'eticket_access_token';

// SecureStore isn't universally available: it has no web implementation, and on an
// emulator without a configured keystore its calls can throw. Falling back to
// AsyncStorage keeps the app usable there instead of failing every authed request —
// the token is no less protected than it was before this change.
let secureStoreBroken = false;

async function secureGet(): Promise<string | null> {
  if (secureStoreBroken) return null;
  try {
    return await SecureStore.getItemAsync(TOKEN_KEY);
  } catch {
    secureStoreBroken = true;
    return null;
  }
}

async function secureSet(token: string): Promise<boolean> {
  if (secureStoreBroken) return false;
  try {
    await SecureStore.setItemAsync(TOKEN_KEY, token);
    return true;
  } catch {
    secureStoreBroken = true;
    return false;
  }
}

async function secureDelete(): Promise<void> {
  if (secureStoreBroken) return;
  try {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
  } catch {
    secureStoreBroken = true;
  }
}

export async function getToken(): Promise<string | null> {
  const secure = await secureGet();
  if (secure) return secure;

  // One-time migration: anyone already signed in before this change has their token
  // sitting under the same key in AsyncStorage. Without this they'd be silently
  // logged out on upgrade. Move it up, then drop the plaintext copy.
  const legacy = await AsyncStorage.getItem(TOKEN_KEY);
  if (legacy) {
    const moved = await secureSet(legacy);
    if (moved) await AsyncStorage.removeItem(TOKEN_KEY);
  }
  return legacy;
}

export async function setToken(token: string | null): Promise<void> {
  if (token) {
    const stored = await secureSet(token);
    if (!stored) await AsyncStorage.setItem(TOKEN_KEY, token);
    return;
  }
  // Logout must clear both stores — a leftover legacy copy would resurrect the session
  // on the next getToken().
  await secureDelete();
  await AsyncStorage.removeItem(TOKEN_KEY);
}
