import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { BASE_URL } from '../api/client';

const AuthContext = createContext(null);

const DEFAULT_PREFS = {
  alert_radius_m: 500,
  notify_ice: true,
  notify_bluetooth: true,
  notify_route: true,
};
const DEFAULT_WARN_SECONDS = 10;
const PREFS_CACHE_KEY = 'user_preferences_cache';

export function AuthProvider({ children }) {
  const [token, setToken]             = useState(null);
  const [userId, setUserId]           = useState(null);
  const [email, setEmail]             = useState(null);
  const [isGuest, setIsGuest]         = useState(false);
  const [loading, setLoading]         = useState(true);
  const [prefs, setPrefs]             = useState(DEFAULT_PREFS);
  const [warnSeconds, setWarnSeconds] = useState(DEFAULT_WARN_SECONDS);
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  const prefsLoadedForUser = useRef(null);

  useEffect(() => {
    Promise.all([
      AsyncStorage.getItem('auth_token'),
      AsyncStorage.getItem('auth_user_id'),
      AsyncStorage.getItem('auth_email'),
      AsyncStorage.getItem('is_guest'),
    ]).then(([t, uid, em, guest]) => {
      if (t) { setToken(t); setUserId(uid); setEmail(em); }
      if (guest === 'true') setIsGuest(true);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (!userId) return;
    // Only load prefs once per user session — never reload unless user changes
    if (prefsLoadedForUser.current === userId) return;
    prefsLoadedForUser.current = userId;
    loadPrefs(userId);
  }, [userId]);

  const loadPrefs = async (uid) => {
    try {
      const stored = await AsyncStorage.getItem('warn_seconds');
      if (stored) setWarnSeconds(Math.round(parseInt(stored) / 5) * 5);
      else setWarnSeconds(DEFAULT_WARN_SECONDS);

      // Load from cache immediately
      const cached = await AsyncStorage.getItem(PREFS_CACHE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        setPrefs({
          alert_radius_m:   parsed.alert_radius_m   ?? DEFAULT_PREFS.alert_radius_m,
          notify_ice:       parsed.notify_ice       ?? DEFAULT_PREFS.notify_ice,
          notify_bluetooth: parsed.notify_bluetooth ?? DEFAULT_PREFS.notify_bluetooth,
          notify_route:     parsed.notify_route     ?? DEFAULT_PREFS.notify_route,
        });
        setPrefsLoaded(true);
      }

      // Sync from backend once — but only update if we get a valid response
      const savedToken = await AsyncStorage.getItem('auth_token');
      const res = await fetch(`${BASE_URL}/api/app/settings`, {
        headers: { Authorization: `Bearer ${savedToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        // Only update if the backend returns a non-default radius
        // (guards against fetching from wrong backend)
        const fresh = {
          alert_radius_m:   data.alert_radius_m   ?? DEFAULT_PREFS.alert_radius_m,
          notify_ice:       data.notify_ice       ?? DEFAULT_PREFS.notify_ice,
          notify_bluetooth: data.notify_bluetooth ?? DEFAULT_PREFS.notify_bluetooth,
          notify_route:     data.notify_route     ?? DEFAULT_PREFS.notify_route,
        };
        setPrefs(fresh);
        await AsyncStorage.setItem(PREFS_CACHE_KEY, JSON.stringify(fresh));
      }
    } catch (err) {
      console.warn('Failed to load prefs:', err.message);
    } finally {
      setPrefsLoaded(true);
    }
  };

  const savePrefs = async (newPrefs, newWarnSeconds) => {
    setPrefs(newPrefs);
    setWarnSeconds(newWarnSeconds);
    await AsyncStorage.setItem('warn_seconds', newWarnSeconds.toString());
    await AsyncStorage.setItem(PREFS_CACHE_KEY, JSON.stringify(newPrefs));
  };

  const login = async (emailInput, password) => {
    const res = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: emailInput, password }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || 'Login failed');
    }
    await _saveSession(await res.json());
  };

  const register = async (emailInput, password) => {
    const res = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: emailInput, password }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || 'Registration failed');
    }
    await _saveSession(await res.json());
  };

  const _saveSession = async (data) => {
    setToken(data.token); setUserId(data.user_id); setEmail(data.email);
    setIsGuest(false);
    await AsyncStorage.multiSet([
      ['auth_token',   data.token],
      ['auth_user_id', data.user_id],
      ['auth_email',   data.email],
    ]);
    await AsyncStorage.removeItem('is_guest');
  };

  const continueAsGuest = async () => {
    setIsGuest(true);
    await AsyncStorage.setItem('is_guest', 'true');
  };

  const logout = async () => {
    setToken(null); setUserId(null); setEmail(null); setIsGuest(false);
    setPrefs(DEFAULT_PREFS); setWarnSeconds(DEFAULT_WARN_SECONDS); setPrefsLoaded(false);
    prefsLoadedForUser.current = null;
    await AsyncStorage.multiRemove(['auth_token', 'auth_user_id', 'auth_email', 'is_guest', PREFS_CACHE_KEY]);
  };

  return (
    <AuthContext.Provider value={{
      token, userId, email,
      accessToken: token,
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
