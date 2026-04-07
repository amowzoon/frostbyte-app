import React, { createContext, useContext, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { BASE_URL } from '../api/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken]     = useState(null);
  const [userId, setUserId]   = useState(null);
  const [email, setEmail]     = useState(null);
  const [isGuest, setIsGuest] = useState(false);
  const [loading, setLoading] = useState(true);

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
    await AsyncStorage.multiRemove(['auth_token', 'auth_user_id', 'auth_email', 'is_guest']);
  };

  return (
    <AuthContext.Provider value={{
      token, userId, email,
      accessToken: token,
      isGuest,
      isLoggedIn: !!token || isGuest,
      loading,
      login, register, continueAsGuest, logout,
    }}>
      {!loading && children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}