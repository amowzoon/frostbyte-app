import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';

const SUPABASE_URL = 'https://izmvxaayfqiznokbpfif.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml6bXZ4YWF5ZnFpem5va2JwZmlmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4MDIxODYsImV4cCI6MjA5MDM3ODE4Nn0.CWXnAk8DPUSG9NSf524Wo_Rb1mf00E43e5nrqzWxui8';

/**
 * Storage adapter for Supabase session.
 *
 * Supabase JWT tokens exceed SecureStore's 2048 byte limit on some devices.
 * Strategy: try SecureStore first (encrypted hardware storage), fall back to
 * AsyncStorage (encrypted at rest on iOS via the app's data protection class,
 * less secure on Android but acceptable for a short-lived session token).
 */
const StorageAdapter = {
  getItem: async (key) => {
    try {
      const val = await SecureStore.getItemAsync(key);
      if (val !== null) return val;
    } catch {
      // SecureStore failed — fall through to AsyncStorage
    }
    try {
      return await AsyncStorage.getItem(key);
    } catch {
      return null;
    }
  },

  setItem: async (key, value) => {
    // Try SecureStore first — if token is too large it throws
    try {
      await SecureStore.setItemAsync(key, value);
      return;
    } catch {
      // Token too large for SecureStore (> 2048 bytes) — use AsyncStorage
    }
    try {
      await AsyncStorage.setItem(key, value);
    } catch (e) {
      console.warn('Supabase storage setItem failed:', e.message);
    }
  },

  removeItem: async (key) => {
    try {
      await SecureStore.deleteItemAsync(key);
    } catch {}
    try {
      await AsyncStorage.removeItem(key);
    } catch {}
  },
};

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: StorageAdapter,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});