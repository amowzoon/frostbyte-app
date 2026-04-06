/**
 * backgroundAlertTask.js
 * Background GPS task that monitors ice alerts even when the app is closed.
 *
 * Uses expo-task-manager + expo-location background mode.
 * Fires a local push notification when the user's projected path
 * enters an ice alert zone within WARN_THRESHOLD_SECONDS.
 *
 * Requires EAS build — background tasks don't work in Expo Go.
 *
 * Registration: call registerBackgroundAlertTask() on app startup.
 * The task runs automatically every ~30 seconds in the background.
 */

import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

export const BACKGROUND_ALERT_TASK = 'FROSTBYTE_BACKGROUND_ALERT';

const WARN_THRESHOLD_SECONDS = 10;
const ALERT_ZONE_RADIUS_M = 80;
const MIN_SPEED_MS = 0.3;
const NOTIFICATION_COOLDOWN_MS = 60 * 1000;

const SUPABASE_URL = 'https://izmvxaayfqiznokbpfif.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml6bXZ4YWF5ZnFpem5va2JwZmlmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4MDIxODYsImV4cCI6MjA5MDM3ODE4Nn0.CWXnAk8DPUSG9NSf524Wo_Rb1mf00E43e5nrqzWxui8';

function toRad(deg) { return deg * Math.PI / 180; }
function toDeg(rad) { return rad * 180 / Math.PI; }

function distanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2)**2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function projectPoint(lat, lon, headingDeg, distM) {
  const bearing = toRad(headingDeg);
  const d = distM / 6371000;
  const lat1 = toRad(lat);
  const lon1 = toRad(lon);
  const lat2 = Math.asin(
    Math.sin(lat1)*Math.cos(d) + Math.cos(lat1)*Math.sin(d)*Math.cos(bearing)
  );
  const lon2 = lon1 + Math.atan2(
    Math.sin(bearing)*Math.sin(d)*Math.cos(lat1),
    Math.cos(d) - Math.sin(lat1)*Math.sin(lat2)
  );
  return { lat: toDeg(lat2), lon: toDeg(lon2) };
}

async function fetchNearbyAlerts(lat, lon) {
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const degOffset = 2000 / 111000.0;
    const now = new Date().toISOString();
    const { data } = await supabase
      .from('ice_alerts')
      .select('id, latitude, longitude, confidence, alert_type')
      .eq('active', true)
      .eq('is_test', false)
      .gt('expires_at', now)
      .gte('latitude', lat - degOffset)
      .lte('latitude', lat + degOffset)
      .gte('longitude', lon - degOffset)
      .lte('longitude', lon + degOffset)
      .limit(20);
    return data || [];
  } catch {
    return [];
  }
}

async function wasRecentlyNotified(alertId) {
  try {
    const ts = await AsyncStorage.getItem(`notified_${alertId}`);
    if (!ts) return false;
    return Date.now() - parseInt(ts) < NOTIFICATION_COOLDOWN_MS;
  } catch { return false; }
}

async function markNotified(alertId) {
  try {
    await AsyncStorage.setItem(`notified_${alertId}`, Date.now().toString());
  } catch {}
}

async function getUserPrefs() {
  try {
    const prefs = await AsyncStorage.getItem('user_preferences_cache');
    return prefs ? JSON.parse(prefs) : { notify_route: true, notify_ice: true };
  } catch {
    return { notify_route: true, notify_ice: true };
  }
}

TaskManager.defineTask(BACKGROUND_ALERT_TASK, async ({ data, error }) => {
  if (error || !data?.locations?.length) return;

  const loc = data.locations[data.locations.length - 1];
  const { latitude, longitude, speed, heading } = loc.coords;

  const prefs = await getUserPrefs();
  if (!prefs.notify_route && !prefs.notify_ice) return;

  const alerts = await fetchNearbyAlerts(latitude, longitude);
  if (!alerts.length) return;

  const speedMs = speed || 0;

  for (const alert of alerts) {
    const distToAlert = distanceMeters(latitude, longitude, alert.latitude, alert.longitude);

    // Route-based warning
    if (prefs.notify_route && speedMs >= MIN_SPEED_MS && heading != null) {
      const lookahead = Math.min(60 + speedMs * 5, 120);
      let hit = null;
      for (let t = 1; t <= lookahead; t++) {
        const pt = projectPoint(latitude, longitude, heading, speedMs * t);
        if (distanceMeters(pt.lat, pt.lon, alert.latitude, alert.longitude) <= ALERT_ZONE_RADIUS_M) {
          hit = t;
          break;
        }
      }
      if (hit !== null) {
        const distToBoundary = Math.max(0, distToAlert - ALERT_ZONE_RADIUS_M);
        const secondsToReach = speedMs > 0 ? Math.round(distToBoundary / speedMs) : hit;
        if (secondsToReach <= WARN_THRESHOLD_SECONDS) {
          if (!await wasRecentlyNotified(`route_${alert.id}`)) {
            await Notifications.scheduleNotificationAsync({
              content: {
                title: '⚠️ Ice ahead on your route',
                body: secondsToReach <= 3
                  ? 'Entering an ice zone — slow down immediately.'
                  : `Black ice ${secondsToReach}s ahead. Slow down.`,
                sound: true,
              },
              trigger: null,
            });
            await markNotified(`route_${alert.id}`);
          }
        }
      }
    }

    // Proximity warning
    if (prefs.notify_ice && distToAlert <= ALERT_ZONE_RADIUS_M) {
      if (!await wasRecentlyNotified(`prox_${alert.id}`)) {
        await Notifications.scheduleNotificationAsync({
          content: {
            title: '🧊 Ice detected nearby',
            body: `Black ice detected ${Math.round(distToAlert)}m from your location.`,
            sound: true,
          },
          trigger: null,
        });
        await markNotified(`prox_${alert.id}`);
      }
    }
  }
});

export async function registerBackgroundAlertTask() {
  try {
    const { status: fg } = await Location.requestForegroundPermissionsAsync();
    if (fg !== 'granted') return false;

    const { status: bg } = await Location.requestBackgroundPermissionsAsync();
    if (bg !== 'granted') {
      console.warn('Background location permission denied');
      return false;
    }

    const isRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_ALERT_TASK);
    if (!isRegistered) {
      await Location.startLocationUpdatesAsync(BACKGROUND_ALERT_TASK, {
        accuracy: Location.Accuracy.Balanced,
        timeInterval: 30000,
        distanceInterval: 20,
        showsBackgroundLocationIndicator: true,
        foregroundService: {
          notificationTitle: 'FrostByte',
          notificationBody: 'Monitoring for ice alerts',
          notificationColor: '#1a1a2e',
        },
      });
    }
    return true;
  } catch (e) {
    console.warn('Background task registration failed:', e.message);
    return false;
  }
}

export async function unregisterBackgroundAlertTask() {
  try {
    const isRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_ALERT_TASK);
    if (isRegistered) await Location.stopLocationUpdatesAsync(BACKGROUND_ALERT_TASK);
  } catch {}
}