/**
 * networkManager.js
 * Fetches ice alerts by polling the backend every 30s.
 * Falls back to cache if backend is unreachable.
 *
 * Layer 1: Backend /api/app/alerts/nearby
 * Layer 2: Cache (AsyncStorage, up to 10 min stale)
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { BASE_URL } from '../api/client';

const CACHE_KEY           = 'cached_alerts';
const CACHE_TIMESTAMP_KEY = 'cached_alerts_timestamp';
const CACHE_MAX_AGE_MS    = 10 * 60 * 1000;

export const FetchSource = {
  BACKEND: 'backend',
  CACHE:   'cache',
  NONE:    'none',
};

async function cacheAlerts(alerts) {
  try {
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(alerts));
    await AsyncStorage.setItem(CACHE_TIMESTAMP_KEY, Date.now().toString());
  } catch (e) {
    console.warn('Failed to cache alerts:', e.message);
  }
}

export async function loadCachedAlerts() {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    const ts  = await AsyncStorage.getItem(CACHE_TIMESTAMP_KEY);
    if (!raw || !ts) return null;
    const ageMs = Date.now() - parseInt(ts, 10);
    return {
      alerts: JSON.parse(raw),
      isStale: ageMs > CACHE_MAX_AGE_MS,
      ageMinutes: Math.floor(ageMs / 60000),
    };
  } catch {
    return null;
  }
}

async function fetchFromBackend(lat, lon, radiusM = 2000) {
  const url = `${BASE_URL}/api/app/alerts/nearby?lat=${lat}&lon=${lon}&radius_m=${radiusM}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);
  const res = await fetch(url, { signal: controller.signal });
  clearTimeout(timeout);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return data.alerts || [];
}

export async function fetchAlerts(lat, lon, radiusM = 2000) {
  try {
    const alerts = await fetchFromBackend(lat, lon, radiusM);
    await cacheAlerts(alerts);
    return { alerts, source: FetchSource.BACKEND, cacheAge: null };
  } catch (e) {
    console.warn('Backend unreachable, using cache:', e.message);
  }

  const cached = await loadCachedAlerts();
  if (cached) {
    return { alerts: cached.alerts, source: FetchSource.CACHE, cacheAge: cached.ageMinutes };
  }

  return { alerts: [], source: FetchSource.NONE, cacheAge: null };
}