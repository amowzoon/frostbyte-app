import React, { createContext, useContext, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(null);
  const [userId, setUserId] = useState(null);
  const [isGuest, setIsGuest] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      AsyncStorage.getItem('auth_token'),
      AsyncStorage.getItem('user_id'),
      AsyncStorage.getItem('is_guest'),
    ]).then(([t, id, guest]) => {
      if (t) setToken(t);
      if (id) setUserId(id);
      if (guest === 'true') setIsGuest(true);
      setLoading(false);
    });
  }, []);

  const login = async (t, id) => {
    setToken(t);
    setUserId(id);
    setIsGuest(false);
    await AsyncStorage.setItem('auth_token', t);
    await AsyncStorage.setItem('user_id', id);
    await AsyncStorage.removeItem('is_guest');
  };

  const continueAsGuest = async () => {
    setIsGuest(true);
    setToken(null);
    setUserId(null);
    await AsyncStorage.setItem('is_guest', 'true');
  };

  const logout = async () => {
    setToken(null);
    setUserId(null);
    setIsGuest(false);
    await AsyncStorage.removeItem('auth_token');
    await AsyncStorage.removeItem('user_id');
    await AsyncStorage.removeItem('is_guest');
  };

  // User is "logged in" if they have a token OR are a guest
  const isLoggedIn = !!token || isGuest;

  return (
    <AuthContext.Provider value={{ token, userId, isGuest, isLoggedIn, loading, login, continueAsGuest, logout }}>
      {!loading && children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}