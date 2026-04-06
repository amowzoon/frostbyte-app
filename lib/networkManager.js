/**
 * networkManager.js
 * Three-layer network fallback for fetching ice alerts.
 * Also exports subscribeToAlerts() for real-time updates via Supabase.
 *
 * Layer 1: Supabase (cloud, works anywhere with internet)
 * Layer 2: Backend Pi proxy (local network, Pi must be reachable)
 * Layer 3: Cache (always available, may be stale)
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import client, { BASE_URL } from '../api/client';

const CACHE_KEY = 'cached_alerts';
const CACHE_TIMESTAMP_KEY = 'cached_alerts_timestamp';
const CACHE_MAX_AGE_MS = 10 * 60 * 1000;

const KNOWN_DEVICE_IDS = ['pi-001'];

export const FetchSource = {
  SUPABASE: 'supabase',
  BACKEND:  'backend',
  PI_PROXY: 'pi_proxy',
  CACHE:    'cache',
  NONE:     'none',
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
    const timestamp = parseInt(ts, 10);
    const ageMs = Date.now() - timestamp;
    return {
      alerts: JSON.parse(raw),
      timestamp,
      isStale: ageMs > CACHE_MAX_AGE_MS,
      ageMinutes: Math.floor(ageMs / 60000),
    };
  } catch (e) {
    return null;
  }
}

async function fetchFromSupabase(lat, lon, radiusM = 2000) {
  const degOffset = radiusM / 111000.0;
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from('ice_alerts')
    .select('id, latitude, longitude, confidence, alert_type, device_id, created_at, expires_at')
    .eq('active', true)
    .eq('is_test', false)
    .gt('expires_at', now)
    .gte('latitude',  lat - degOffset)
    .lte('latitude',  lat + degOffset)
    .gte('longitude', lon - degOffset)
    .lte('longitude', lon + degOffset)
    .order('confidence', { ascending: false })
    .limit(50);

  if (error) throw new Error(error.message);
  return data || [];
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

async function fetchFromPiProxy(lat, lon) {
  const results = [];
  for (const deviceId of KNOWN_DEVICE_IDS) {
    try {
      const healthRes = await client.get(
        `/api/devices/${deviceId}/api/health`,
        { timeout: 4000 }
      );
      if (healthRes.data?.status !== 'ok') continue;

      const tempRes = await client.get(
        `/api/devices/${deviceId}/api/temperature/status`,
        { timeout: 4000 }
      );
      const tempC = tempRes.data?.pico?.adc_sanity?.s1_c ?? null;

      if (tempC !== null && tempC <= 2.0) {
        const confidence = Math.min(0.4, Math.max(0.1, (2.0 - tempC) / 10.0));
        results.push({
          id: `proxy-${deviceId}-${Date.now()}`,
          latitude: lat,
          longitude: lon,
          confidence,
          alert_type: 'temperature',
          device_id: deviceId,
          created_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
          source: 'pi_proxy',
        });
      }
    } catch (e) {
      console.warn(`Pi proxy query failed for ${deviceId}:`, e.message);
    }
  }
  return results;
}

export async function fetchAlerts(lat, lon, radiusM = 2000) {
  try {
    const alerts = await fetchFromSupabase(lat, lon, radiusM);
    await cacheAlerts(alerts);
    return { alerts, source: FetchSource.SUPABASE, cacheAge: null };
  } catch (e) {
    console.warn('Supabase unreachable, trying backend:', e.message);
  }

  try {
    const alerts = await fetchFromBackend(lat, lon, radiusM);
    await cacheAlerts(alerts);
    return { alerts, source: FetchSource.BACKEND, cacheAge: null };
  } catch (e) {
    console.warn('Backend unreachable, trying Pi proxy:', e.message);
  }

  try {
    const alerts = await fetchFromPiProxy(lat, lon);
    if (alerts.length > 0) {
      await cacheAlerts(alerts);
      return { alerts, source: FetchSource.PI_PROXY, cacheAge: null };
    }
  } catch (e) {
    console.warn('Pi proxy failed:', e.message);
  }

  const cached = await loadCachedAlerts();
  if (cached) {
    return { alerts: cached.alerts, source: FetchSource.CACHE, cacheAge: cached.ageMinutes };
  }

  return { alerts: [], source: FetchSource.NONE, cacheAge: null };
}

/**
 * Subscribe to real-time alert changes from Supabase.
 * Calls onInsert when a new alert is added.
 * Calls onUpdate when an alert is modified (e.g. deactivated).
 * Calls onDelete when an alert is deleted.
 * Returns the channel — call channel.unsubscribe() to stop listening.
 *
 * Usage in HomeScreen:
 *   const channel = subscribeToAlerts(
 *     (alert) => setAllAlerts(prev => [...prev, alert]),
 *     (alert) => setAllAlerts(prev => prev.map(a => a.id === alert.id ? alert : a)),
 *     (alert) => setAllAlerts(prev => prev.filter(a => a.id !== alert.id))
 *   );
 *   // on unmount:
 *   channel.unsubscribe();
 */
export function subscribeToAlerts(onInsert, onUpdate, onDelete) {
  const channel = supabase
    .channel('ice_alerts_realtime')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'ice_alerts' },
      (payload) => {
        const alert = payload.new;
        // Only surface real, active, non-test alerts
        if (alert.active && !alert.is_test) {
          onInsert(alert);
        }
      }
    )
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'ice_alerts' },
      (payload) => {
        const alert = payload.new;
        // If alert was deactivated, treat as delete
        if (!alert.active || alert.is_test) {
          onDelete(alert);
        } else {
          onUpdate(alert);
        }
      }
    )
    .on(
      'postgres_changes',
      { event: 'DELETE', schema: 'public', table: 'ice_alerts' },
      (payload) => {
        onDelete(payload.old);
      }
    )
    .subscribe();

  return channel;
}

export async function publishAlertToSupabase(alert) {
  const { data, error } = await supabase
    .from('ice_alerts')
    .insert([alert])
    .select()
    .single();

  if (error) {
    console.warn('Failed to publish alert to Supabase:', error.message);
    return null;
  }
  return data;
}

export async function getDeviceHealth() {
  const statuses = [];
  for (const deviceId of KNOWN_DEVICE_IDS) {
    try {
      const [health, camera, ir, radar, temp] = await Promise.allSettled([
        client.get(`/api/devices/${deviceId}/api/health`,              { timeout: 4000 }),
        client.get(`/api/devices/${deviceId}/api/camera/status`,       { timeout: 4000 }),
        client.get(`/api/devices/${deviceId}/api/ir/status`,           { timeout: 4000 }),
        client.get(`/api/devices/${deviceId}/api/radar/status`,        { timeout: 4000 }),
        client.get(`/api/devices/${deviceId}/api/temperature/status`,  { timeout: 4000 }),
      ]);
      statuses.push({
        deviceId,
        connected: health.status === 'fulfilled' && health.value?.data?.status === 'ok',
        sensors: {
          camera:      camera.status === 'fulfilled' ? camera.value?.data : null,
          ir:          ir.status === 'fulfilled' ? ir.value?.data : null,
          radar:       radar.status === 'fulfilled' ? radar.value?.data : null,
          temperature: temp.status === 'fulfilled' ? temp.value?.data : null,
        },
      });
    } catch (e) {
      statuses.push({ deviceId, connected: false, sensors: {} });
    }
  }
  return statuses;
}