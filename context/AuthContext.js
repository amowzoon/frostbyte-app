import React, { createContext, useContext, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);   // Supabase session object
  const [user, setUser] = useState(null);          // Supabase user object
  const [isGuest, setIsGuest] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // On mount: get current session from SecureStore (if any)
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
    });

    // Restore guest mode flag
    AsyncStorage.getItem('is_guest').then(val => {
      if (val === 'true') setIsGuest(true);
      setLoading(false);
    });

    // Listen for auth state changes (login, logout, token refresh)
    // Fires automatically when Supabase refreshes the token in the background
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
        if (session) setIsGuest(false);
      }
    );

    // Unsubscribe when component unmounts
    return () => subscription.unsubscribe();
  }, []);

  const login = async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) throw error;
    // Session is automatically persisted to SecureStore by the Supabase client
    await AsyncStorage.removeItem('is_guest');
    setIsGuest(false);
    return data;
  };

  const register = async (email, password) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
    });
    if (error) throw error;
    // Supabase may require email confirmation depending on project settings
    // Session is set automatically if email confirmation is disabled
    await AsyncStorage.removeItem('is_guest');
    setIsGuest(false);
    return data;
  };

  const continueAsGuest = async () => {
    setIsGuest(true);
    await AsyncStorage.setItem('is_guest', 'true');
  };

  const logout = async () => {
    await supabase.auth.signOut();
    // signOut clears the session from SecureStore automatically
    setIsGuest(false);
    await AsyncStorage.removeItem('is_guest');
  };

  // The JWT access token for authenticated API requests to your backend
  // This is a Supabase-issued JWT, valid for 1 hour, auto-refreshed
  const accessToken = session?.access_token ?? null;

  // User ID from Supabase — a UUID
  const userId = user?.id ?? null;

  // User email
  const email = user?.email ?? null;

  const isLoggedIn = !!session || isGuest;

  return (
    <AuthContext.Provider value={{
      session,
      user,
      userId,
      email,
      accessToken,
      isGuest,
      isLoggedIn,
      loading,
      login,
      register,
      continueAsGuest,
      logout,
    }}>
      {!loading && children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
