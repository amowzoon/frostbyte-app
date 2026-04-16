/**
 * context/AuthContext.js
 *
 * Security changes:
 *  - JWT token, user_id, email now stored in SecureStore (Android Keystore /
 *    iOS Keychain) instead of AsyncStorage. SecureStore values are encrypted
 *    at rest and excluded from unencrypted device backups.
 *  - Non-sensitive prefs (alert_radius_m, notify_*, warn_seconds) remain in
 *    AsyncStorage — they contain no credentials.
 *  - Guest flag moved to SecureStore for consistency.
 */

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { BASE_URL } from '../api/client';
import {
  setSecure, getSecure, deleteSecure, clearAllSecure,
  TOKEN_KEY, USER_ID_KEY, EMAIL_KEY, GUEST_KEY,
} from '../lib/secureStorage';

const PREFS_CACHE_KEY     = 'frostbyte_prefs_cache';
const WARN_SECONDS_KEY    = 'frostbyte_warn_seconds';
const DEFAULT_WARN_SECONDS = 10;
const DEFAULT_PREFS = {
  alert_radius_m:   500,
  notify_ice:       true,
  notify_bluetooth: true,
  notify_route:     true,
  conf_min:         0,
};

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token,       setToken]       = useState(null);
  const [userId,      setUserId]      = useState(null);
  const [email,       setEmail]       = useState(null);
  const [isGuest,     setIsGuest]     = useState(false);
  const [loading,     setLoading]     = useState(true);
  const [prefs,       setPrefs]       = useState(DEFAULT_PREFS);
  const [warnSeconds, setWarnSeconds] = useState(DEFAULT_WARN_SECONDS);
  const [prefsLoaded, setPrefsLoaded] = useState(false);

  // Prevent prefs from loading more than once per user session
  const prefsLoadedForUser = useRef(null);

  // ── Restore session on mount ──────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const [t, uid, em, guest, cachedPrefs, cachedWarn] = await Promise.all([
          getSecure(TOKEN_KEY),
          getSecure(USER_ID_KEY),
          getSecure(EMAIL_KEY),
          getSecure(GUEST_KEY),
          AsyncStorage.getItem(PREFS_CACHE_KEY),
          AsyncStorage.getItem(WARN_SECONDS_KEY),
        ]);

        if (t)  { setToken(t); setUserId(uid); setEmail(em); }
        if (guest === 'true') setIsGuest(true);
        if (cachedPrefs) setPrefs({ ...DEFAULT_PREFS, ...JSON.parse(cachedPrefs) });
        if (cachedWarn)  setWarnSeconds(Number(cachedWarn));
      } catch (e) {
        console.warn('[AuthContext] restore session error:', e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // ── Load prefs from backend (once per user) ───────────────────────────────
  const loadPrefs = useCallback(async (uid) => {
    if (prefsLoadedForUser.current === uid) return;
    prefsLoadedForUser.current = uid;
    try {
      const res = await fetch(`${BASE_URL}/api/app/settings`, {
        headers: { Authorization: `Bearer ${await getSecure(TOKEN_KEY)}` },
      });
      if (res.ok) {
        const data = await res.json();
        const fresh = {
          alert_radius_m:   data.alert_radius_m   ?? DEFAULT_PREFS.alert_radius_m,
          notify_ice:       data.notify_ice        ?? DEFAULT_PREFS.notify_ice,
          notify_bluetooth: data.notify_bluetooth  ?? DEFAULT_PREFS.notify_bluetooth,
          notify_route:     data.notify_route      ?? DEFAULT_PREFS.notify_route,
          conf_min:         data.conf_min          ?? DEFAULT_PREFS.conf_min,
        };
        setPrefs(fresh);
        await AsyncStorage.setItem(PREFS_CACHE_KEY, JSON.stringify(fresh));
      }
    } catch (e) {
      console.warn('[AuthContext] loadPrefs error:', e.message);
    } finally {
      setPrefsLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (userId) loadPrefs(userId);
    if (isGuest) setPrefsLoaded(true);
  }, [userId, isGuest, loadPrefs]);

  // ── savePrefs ─────────────────────────────────────────────────────────────
  const savePrefs = useCallback(async (newPrefs, newWarnSeconds) => {
    setPrefs(newPrefs);
    setWarnSeconds(newWarnSeconds);
    await Promise.all([
      AsyncStorage.setItem(WARN_SECONDS_KEY, String(newWarnSeconds)),
      AsyncStorage.setItem(PREFS_CACHE_KEY, JSON.stringify(newPrefs)),
    ]);
  }, []);

  // ── _saveSession ──────────────────────────────────────────────────────────
  const _saveSession = useCallback(async (data) => {
    setToken(data.token);
    setUserId(data.user_id);
    setEmail(data.email);
    setIsGuest(false);
    // Store credentials in SecureStore (encrypted at rest)
    await Promise.all([
      setSecure(TOKEN_KEY,   data.token),
      setSecure(USER_ID_KEY, data.user_id),
      setSecure(EMAIL_KEY,   data.email),
      deleteSecure(GUEST_KEY),
    ]);
  }, []);

  // ── login ─────────────────────────────────────────────────────────────────
  const login = useCallback(async (emailInput, password) => {
    if (!BASE_URL) {
      throw new Error('Backend URL not configured. Republish with BACKEND_URL set.');
    }
    const res = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: emailInput, password }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Login failed');
    }
    await _saveSession(await res.json());
  }, [_saveSession]);

  // ── register ──────────────────────────────────────────────────────────────
  const register = useCallback(async (emailInput, password) => {
    if (!BASE_URL) {
      throw new Error('Backend URL not configured. Republish with BACKEND_URL set.');
    }
    const res = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: emailInput, password }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Registration failed');
    }
    await _saveSession(await res.json());
  }, [_saveSession]);

  // ── continueAsGuest ───────────────────────────────────────────────────────
  const continueAsGuest = useCallback(async () => {
    setIsGuest(true);
    await setSecure(GUEST_KEY, 'true');
  }, []);

  // ── logout ────────────────────────────────────────────────────────────────
  const logout = useCallback(async () => {
    setToken(null); setUserId(null); setEmail(null);
    setIsGuest(false); setPrefs(DEFAULT_PREFS);
    setWarnSeconds(DEFAULT_WARN_SECONDS); setPrefsLoaded(false);
    prefsLoadedForUser.current = null;
    await Promise.all([
      clearAllSecure(),
      AsyncStorage.multiRemove([PREFS_CACHE_KEY, WARN_SECONDS_KEY]),
    ]);
  }, []);

  return (
    <AuthContext.Provider value={{
      token, userId, email,
      isGuest,
      isLoggedIn: !!token || isGuest,
      loading,
      prefs, warnSeconds, prefsLoaded, savePrefs,
      login, register, continueAsGuest, logout,
    }}>
      {!loading && children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}