/**
 * networkManager.js
<<<<<<< HEAD
 * Primary: WebSocket /ws/alerts (instant push)
 * Fallback: HTTP poll every 5s
 * Last resort: AsyncStorage cache
=======
 * Fetches ice alerts by polling the backend every 30s as fallback.
 * Primary: WebSocket subscription for instant alert delivery.
 *
 * Layer 1: WebSocket /ws/alerts (instant push)
 * Layer 2: Backend /api/app/alerts/nearby (30s poll fallback)
 * Layer 3: Cache (AsyncStorage, up to 10 min stale)
>>>>>>> 5abe7f9aa115fd3977ebae156dc8afcaebe77fe7
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { BASE_URL } from '../api/client';

const CACHE_KEY           = 'cached_alerts';
const CACHE_TIMESTAMP_KEY = 'cached_alerts_timestamp';
const CACHE_MAX_AGE_MS    = 10 * 60 * 1000;

export const FetchSource = {
  WEBSOCKET: 'websocket',
  BACKEND:   'backend',
  CACHE:     'cache',
  NONE:      'none',
};

<<<<<<< HEAD
=======
// Convert http/https to ws/wss
>>>>>>> 5abe7f9aa115fd3977ebae156dc8afcaebe77fe7
const WS_URL = BASE_URL.replace(/^http/, 'ws') + '/ws/alerts';

let _wsInstance = null;
let _onAlertCallback = null;
let _reconnectTimer = null;
<<<<<<< HEAD
let _isConnected = false;

export function isWebSocketConnected() {
  return _isConnected;
}
=======
>>>>>>> 5abe7f9aa115fd3977ebae156dc8afcaebe77fe7

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

<<<<<<< HEAD
=======
/**
 * Subscribe to real-time alert pushes via WebSocket.
 * onAlert(alert) is called when a new alert arrives.
 * Returns a cleanup function to close the socket.
 */
>>>>>>> 5abe7f9aa115fd3977ebae156dc8afcaebe77fe7
export function subscribeToAlerts(onAlert) {
  _onAlertCallback = onAlert;

  function connect() {
    if (_wsInstance) {
      try { _wsInstance.close(); } catch {}
    }

    const ws = new WebSocket(WS_URL);
    _wsInstance = ws;

    ws.onopen = () => {
<<<<<<< HEAD
      _isConnected = true;
=======
>>>>>>> 5abe7f9aa115fd3977ebae156dc8afcaebe77fe7
      console.log('[WS] Connected to alert stream');
      if (_reconnectTimer) { clearTimeout(_reconnectTimer); _reconnectTimer = null; }
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'new_alert' && msg.alert && _onAlertCallback) {
<<<<<<< HEAD
=======
          console.log('[WS] New alert received:', msg.alert.id);
>>>>>>> 5abe7f9aa115fd3977ebae156dc8afcaebe77fe7
          _onAlertCallback(msg.alert);
        }
      } catch (e) {
        console.warn('[WS] Failed to parse message:', e.message);
      }
    };

    ws.onerror = (e) => {
      console.warn('[WS] Error:', e.message);
    };

    ws.onclose = () => {
<<<<<<< HEAD
      _isConnected = false;
=======
>>>>>>> 5abe7f9aa115fd3977ebae156dc8afcaebe77fe7
      console.log('[WS] Disconnected — reconnecting in 5s');
      _wsInstance = null;
      _reconnectTimer = setTimeout(connect, 5000);
    };
  }

  connect();

  return () => {
    _onAlertCallback = null;
<<<<<<< HEAD
    _isConnected = false;
=======
>>>>>>> 5abe7f9aa115fd3977ebae156dc8afcaebe77fe7
    if (_reconnectTimer) { clearTimeout(_reconnectTimer); _reconnectTimer = null; }
    if (_wsInstance) { try { _wsInstance.close(); } catch {} _wsInstance = null; }
  };
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
    // If WebSocket is connected, report as WEBSOCKET so banner stays "Live"
    const source = _isConnected ? FetchSource.WEBSOCKET : FetchSource.BACKEND;
    return { alerts, source, cacheAge: null };
  } catch (e) {
    console.warn('Backend unreachable, using cache:', e.message);
  }

  const cached = await loadCachedAlerts();
  if (cached) {
    return { alerts: cached.alerts, source: FetchSource.CACHE, cacheAge: cached.ageMinutes };
  }

  return { alerts: [], source: FetchSource.NONE, cacheAge: null };
}
