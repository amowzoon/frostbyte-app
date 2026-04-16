/**
 * lib/secureStorage.js
 *
 * Wraps expo-secure-store for sensitive values (JWT, push token).
 * SecureStore uses the Android Keystore / iOS Keychain — values are
 * encrypted at rest and never appear in AsyncStorage or device backups.
 *
 * Falls back to AsyncStorage for web/Expo Go simulator where SecureStore
 * is unavailable, so dev workflow is unaffected.
 */

import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const TOKEN_KEY     = 'frostbyte_jwt';
export const USER_ID_KEY   = 'frostbyte_user_id';
export const EMAIL_KEY     = 'frostbyte_email';
export const GUEST_KEY     = 'frostbyte_is_guest';

export async function setSecure(key, value) {
  try {
    await SecureStore.setItemAsync(key, value ?? '');
  } catch {
    await AsyncStorage.setItem(key, value ?? '');
  }
}

export async function getSecure(key) {
  try {
    const val = await SecureStore.getItemAsync(key);
    // If SecureStore returns null, also check AsyncStorage in case it was
    // stored there before (e.g. migrating from old AsyncStorage session)
    if (val !== null) return val;
    return await AsyncStorage.getItem(key);
  } catch {
    return await AsyncStorage.getItem(key);
  }
}

export async function deleteSecure(key) {
  try {
    await SecureStore.deleteItemAsync(key);
  } catch {}
  await AsyncStorage.removeItem(key);
}

export async function clearAllSecure() {
  await Promise.all([
    deleteSecure(TOKEN_KEY),
    deleteSecure(USER_ID_KEY),
    deleteSecure(EMAIL_KEY),
    deleteSecure(GUEST_KEY),
  ]);
}