/**
 * backgroundAlertTask.js
 * Background GPS polling task with speed-adaptive warning threshold.
 *
 * Speed-adaptive logic:
 *   - Base distance = warnSeconds (from prefs, default 10s)
 *   - Effective warn distance = warnSeconds * speed_mps
 *   - Capped at SPEED_ADAPTIVE_MAX_M (300m) and floored at SPEED_ADAPTIVE_MIN_M (30m)
 *   - At 0 speed (stationary), uses STATIONARY_WARN_M (50m flat radius)
 */

import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { getSecure, TOKEN_KEY } from './secureStorage';
import client from '../api/client';

export const BACKGROUND_TASK_NAME = 'FROSTBYTE_BACKGROUND_ALERT';

const POLL_INTERVAL_MS = 30_000;
const SPEED_ADAPTIVE_MAX_M = 300;
const SPEED_ADAPTIVE_MIN_M = 30;
const STATIONARY_WARN_M    = 50;   // used when speed < 0.5 m/s
const SPEED_STATIONARY_THRESHOLD = 0.5; // m/s (~1.8 km/h)

/**
 * Compute effective warning radius in meters.
 * @param {number} warnSeconds - base preference (seconds of lead time)
 * @param {number|null} speedMps - current GPS speed in m/s (null if unknown)
 * @returns {number} radius in meters
 */
export function computeWarnRadius(warnSeconds, speedMps) {
  if (speedMps == null || speedMps < SPEED_STATIONARY_THRESHOLD) {
    return STATIONARY_WARN_M;
  }
  const raw = warnSeconds * speedMps;
  return Math.min(SPEED_ADAPTIVE_MAX_M, Math.max(SPEED_ADAPTIVE_MIN_M, raw));
}

/**
 * Get descriptive label for current speed-adaptive state (shown in Settings).
 */
export function describeWarnRadius(warnSeconds, speedMps) {
  if (speedMps == null) return `${STATIONARY_WARN_M}m (speed unknown)`;
  if (speedMps < SPEED_STATIONARY_THRESHOLD) return `${STATIONARY_WARN_M}m (stationary)`;
  const radius = computeWarnRadius(warnSeconds, speedMps);
  const kmh = (speedMps * 3.6).toFixed(0);
  return `${Math.round(radius)}m @ ${kmh} km/h`;
}

TaskManager.defineTask(BACKGROUND_TASK_NAME, async ({ data, error }) => {
  if (error) {
    console.warn('[BGTask] error:', error.message);
    return;
  }
  if (!data?.locations?.length) return;

  const { latitude, longitude, speed } = data.locations[data.locations.length - 1].coords;
  // speed is m/s on both iOS and Android (may be -1 if unavailable)
  const speedMps = speed != null && speed >= 0 ? speed : null;

  try {
    const token = await getSecure(TOKEN_KEY);
    if (!token) return;

    // Fetch prefs to get warnSeconds
    const prefsResp = await client.get('/api/app/settings');
    const warnSeconds = prefsResp?.data?.warn_seconds ?? 10;

    const radiusM = computeWarnRadius(warnSeconds, speedMps);

    const resp = await client.get('/api/app/alerts/nearby', {
      params: { lat: latitude, lon: longitude, radius_m: radiusM },
    });

    const alerts = resp?.data ?? [];
    if (alerts.length > 0) {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: '🧊 Black Ice Detected',
          body: `${alerts.length} ice alert${alerts.length > 1 ? 's' : ''} within ${Math.round(radiusM)}m`,
          data: { alerts },
        },
        trigger: null,
      });
    }
  } catch (e) {
    console.warn('[BGTask] poll failed:', e.message);
  }
});

export async function registerBackgroundAlertTask() {
  try {
    const { status } = await Location.requestBackgroundPermissionsAsync();
    if (status !== 'granted') {
      console.log('[BGTask] background location permission not granted — skipping (normal in Expo Go)');
      return;
    }

    const isRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_TASK_NAME);
    if (!isRegistered) {
      await Location.startLocationUpdatesAsync(BACKGROUND_TASK_NAME, {
        accuracy: Location.Accuracy.Balanced,
        timeInterval: POLL_INTERVAL_MS,
        distanceInterval: 20,
        showsBackgroundLocationIndicator: true,
        foregroundService: {
          notificationTitle: 'FrostByte',
          notificationBody: 'Monitoring for black ice nearby',
        },
      });
    }
  } catch (e) {
    // Background location unavailable in Expo Go on iOS (missing Info.plist keys).
    // Foreground alerts still work normally.
    console.log('[BGTask] background task skipped:', e.message);
  }
}

export async function unregisterBackgroundAlertTask() {
  const isRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_TASK_NAME);
  if (isRegistered) {
    await Location.stopLocationUpdatesAsync(BACKGROUND_TASK_NAME);
  }
}