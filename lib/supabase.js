import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';

// Your Supabase project credentials
// These are safe to commit — the anon key is public by design
const SUPABASE_URL = 'https://izmvxaayfqiznokbpfif.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_Uwt9-CXzQADkItYjxzaavA_M3L12YK3';

// SecureStore adapter — stores session token encrypted on device
// Falls back to AsyncStorage for web/simulator where SecureStore is unavailable
const SecureStoreAdapter = {
  getItem: async (key) => {
    try {
      return await SecureStore.getItemAsync(key);
    } catch {
      return await AsyncStorage.getItem(key);
    }
  },
  setItem: async (key, value) => {
    try {
      await SecureStore.setItemAsync(key, value);
    } catch {
      await AsyncStorage.setItem(key, value);
    }
  },
  removeItem: async (key) => {
    try {
      await SecureStore.deleteItemAsync(key);
    } catch {
      await AsyncStorage.removeItem(key);
    }
  },
};

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: SecureStoreAdapter,   // encrypted on-device session storage
    autoRefreshToken: true,         // silently refreshes token before it expires
    persistSession: true,           // session survives app restarts
    detectSessionInUrl: false,      // not a web app, disable URL-based auth
  },
});