import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const THEME_OVERRIDE_KEY = '@frostbyte_theme_override';

// ─── Palette ────────────────────────────────────────────────────────────────
export const THEMES = {
  dark: {
    mode: 'dark',
    // backgrounds
    bg:           '#0d1117',
    bgCard:       '#161b22',
    bgInput:      '#21262d',
    bgOverlay:    'rgba(0,0,0,0.6)',
    // surfaces
    surface:      '#1c2128',
    surfaceHover: '#2d333b',
    border:       '#30363d',
    // text
    text:         '#e6edf3',
    textMuted:    '#8b949e',
    textSubtle:   '#656d76',
    // brand/accent
    accent:       '#58a6ff',
    accentBg:     'rgba(88,166,255,0.12)',
    // status
    success:      '#3fb950',
    successBg:    'rgba(63,185,80,0.12)',
    warning:      '#d29922',
    warningBg:    'rgba(210,153,34,0.12)',
    danger:       '#f85149',
    dangerBg:     'rgba(248,81,73,0.12)',
    // map
    mapBannerBg:  'rgba(13,17,23,0.92)',
    // confidence pill colors
    confHigh:     '#3fb950',
    confMed:      '#d29922',
    confLow:      '#f85149',
  },
  light: {
    mode: 'light',
    bg:           '#ffffff',
    bgCard:       '#f6f8fa',
    bgInput:      '#f0f2f4',
    bgOverlay:    'rgba(0,0,0,0.35)',
    surface:      '#ffffff',
    surfaceHover: '#eaeef2',
    border:       '#d0d7de',
    text:         '#1f2328',
    textMuted:    '#57606a',
    textSubtle:   '#8c959f',
    accent:       '#0969da',
    accentBg:     'rgba(9,105,218,0.1)',
    success:      '#1a7f37',
    successBg:    'rgba(26,127,55,0.1)',
    warning:      '#9a6700',
    warningBg:    'rgba(154,103,0,0.1)',
    danger:       '#d1242f',
    dangerBg:     'rgba(209,36,47,0.1)',
    mapBannerBg:  'rgba(255,255,255,0.92)',
    confHigh:     '#1a7f37',
    confMed:      '#9a6700',
    confLow:      '#d1242f',
  },
};

const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
  const systemScheme = useColorScheme();
  // Default to 'dark' — overwritten by stored preference on load
  const [override, setOverride] = useState('dark');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(THEME_OVERRIDE_KEY).then((val) => {
      if (val === 'dark' || val === 'light') setOverride(val);
      // If nothing stored, keep 'dark' default (don't set null/follow system)
      setLoaded(true);
    });
  }, []);

  const activeMode = override ?? 'dark';
  const theme = THEMES[activeMode];

  const setThemeOverride = useCallback(async (value) => {
    // value: 'dark' | 'light' | null (null = follow system)
    setOverride(value);
    if (value === null) {
      await AsyncStorage.removeItem(THEME_OVERRIDE_KEY);
    } else {
      await AsyncStorage.setItem(THEME_OVERRIDE_KEY, value);
    }
  }, []);

  const toggleTheme = useCallback(() => {
    const next = activeMode === 'dark' ? 'light' : 'dark';
    setThemeOverride(next);
  }, [activeMode, setThemeOverride]);

  if (!loaded) return null;

  return (
    <ThemeContext.Provider
      value={{ theme, activeMode, override, systemScheme, toggleTheme, setThemeOverride }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}