import React, { useState, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ActivityIndicator, Alert, Switch, ScrollView, Platform
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { registerBackgroundAlertTask } from '../lib/backgroundAlertTask';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext'; // NEW
import { MaterialIcons } from '@expo/vector-icons';
import client from '../api/client';

const snapToStep = (v) => Math.round(v / 5) * 5;
const THUMB = 28;
const TRACK_H = 4;

function CustomSlider({ value, minimumValue, maximumValue, step, onValueChange }) {
  const containerRef = useRef(null);
  const containerPageXRef = useRef(0);
  const containerWidthRef = useRef(0);
  const isDragging = useRef(false);
  const [pct, setPct] = useState(() => (value - minimumValue) / (maximumValue - minimumValue));
  const [ready, setReady] = useState(false);

  const clamp = (v) => Math.max(minimumValue, Math.min(maximumValue, v));
  const toValue = (p) => {
    const raw = minimumValue + Math.max(0, Math.min(1, p)) * (maximumValue - minimumValue);
    return step ? Math.round(raw / step) * step : raw;
  };

  React.useEffect(() => {
    if (!isDragging.current) {
      setPct((clamp(value) - minimumValue) / (maximumValue - minimumValue));
    }
  }, [value]);

  const onLayout = (e) => {
    // Use layout width directly — no async measure() call needed here
    containerWidthRef.current = e.nativeEvent.layout.width;
    setReady(true);
  };

  const handleTouch = (pageX) => {
    const w = containerWidthRef.current;
    const x0 = containerPageXRef.current;
    if (!w || x0 === 0) return;
    const p = Math.max(0, Math.min(1, (pageX - x0) / w));
    setPct(p);
    onValueChange && onValueChange(toValue(p));
  };

  const handlers = {
    onStartShouldSetResponder: () => true,
    onMoveShouldSetResponder: () => true,
    onResponderGrant: (e) => {
      isDragging.current = true;
      if (containerRef.current) {
        containerRef.current.measure((fx, fy, fw, fh, px) => {
          containerPageXRef.current = px;
          containerWidthRef.current = fw;
        });
      }
      handleTouch(e.nativeEvent.pageX);
    },
    onResponderMove: (e) => { handleTouch(e.nativeEvent.pageX); },
    onResponderRelease: () => { isDragging.current = false; },
    onResponderTerminate: () => { isDragging.current = false; },
    onResponderTerminationRequest: () => false,
  };

  // thumb center sits at pct * containerWidth, offset by half thumb to center it
  const thumbLeft = ready ? Math.max(0, Math.min(pct * (containerWidthRef.current - THUMB), containerWidthRef.current - THUMB)) : null;

  return (
    <View ref={containerRef} style={csStyles.container} onLayout={onLayout} {...handlers}>
      <View style={csStyles.track}>
        <View style={[csStyles.fill, { width: `${pct * 100}%` }]} />
      </View>
      {thumbLeft !== null && (
        <View style={[csStyles.thumb, { left: thumbLeft }]}>
          <Text style={csStyles.snowflake}>❄</Text>
        </View>
      )}
    </View>
  );
}

const csStyles = StyleSheet.create({
  container: { height: 44, justifyContent: 'center' },
  track:     { height: TRACK_H, backgroundColor: '#333', borderRadius: 2, overflow: 'hidden' },
  fill:      { height: TRACK_H, backgroundColor: '#4fc3f7' },
  thumb:     {
    position: 'absolute',
    width: THUMB, height: THUMB,
    borderRadius: THUMB / 2,
    backgroundColor: '#4fc3f7',
    top: '50%', marginTop: -(THUMB / 2),
    justifyContent: 'center', alignItems: 'center',
    shadowColor: '#4fc3f7', shadowOpacity: 0.4,
    shadowOffset: { width: 0, height: 1 }, shadowRadius: 4,
    elevation: 4,
  },
  snowflake: { fontSize: 14, color: '#fff', lineHeight: 16 },
});

export default function SettingsScreen({ navigation }) {
  const { logout, email, userId, prefs: savedPrefs, warnSeconds: savedWarnSeconds, prefsLoaded, savePrefs } = useAuth();
  const { activeMode, setThemeOverride, theme } = useTheme(); // NEW

  const [saving, setSaving]           = useState(false);
  const [prefs, setPrefs]             = useState(savedPrefs);
  const [warnSeconds, setWarnSeconds] = useState(savedWarnSeconds);

  const prevRadiusRef = useRef(savedPrefs?.alert_radius_m);
  const prevWarnRef   = useRef(savedWarnSeconds);
  React.useEffect(() => {
    if (savedPrefs?.alert_radius_m !== prevRadiusRef.current) {
      prevRadiusRef.current = savedPrefs?.alert_radius_m;
      setPrefs(savedPrefs);
    }
    if (savedWarnSeconds !== prevWarnRef.current) {
      prevWarnRef.current = savedWarnSeconds;
      setWarnSeconds(savedWarnSeconds);
    }
  }, [savedPrefs?.alert_radius_m, savedPrefs?.notify_ice, savedPrefs?.notify_bluetooth, savedPrefs?.notify_route, savedWarnSeconds]);

  const saveSettings = async () => {
    setSaving(true);
    try {
      await client.patch('/api/app/settings', { user_id: userId, ...prefs });
      await savePrefs(prefs, warnSeconds);
      await registerBackgroundAlertTask();
      Alert.alert('Saved', 'Your settings have been updated.');
    } catch (err) {
      Alert.alert('Error', 'Failed to save settings: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const setPref = (key, value) => setPrefs(prev => ({ ...prev, [key]: value }));

  // NEW: theme-driven colors (replaces hardcoded dark values)
  const bg        = theme.mode === 'light' ? '#f0f2f5' : '#1a1a2e';
  const cardBg    = theme.mode === 'light' ? '#ffffff' : '#16213e';
  const inputBg   = theme.mode === 'light' ? '#e8eaed' : '#0f1b2d';
  const border    = theme.mode === 'light' ? '#d0d7de' : '#0f3460';
  const textPrim  = theme.mode === 'light' ? '#1f2328' : '#ffffff';
  const textMuted = theme.mode === 'light' ? '#57606a' : '#888888';
  const textSub   = theme.mode === 'light' ? '#8c959f' : '#666666';
  const accent    = '#4fc3f7';

  if (!prefsLoaded) {
    return (
      <SafeAreaView style={[styles.loadingContainer, { backgroundColor: bg }]}>
        <ActivityIndicator size="large" color={accent} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: bg }]}>
      <View style={[styles.header, { backgroundColor: bg, borderBottomColor: border }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <MaterialIcons name="arrow-back" size={22} color={accent} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: textPrim }]}>Settings</Text>
        <View style={{ width: 60 }} />
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" style={{ flex: 1 }} overScrollMode="never">

        {/* ── Account (original) ── */}
        <View style={[styles.section, { backgroundColor: cardBg }]}>
          <Text style={[styles.sectionTitle, { color: accent }]}>Account</Text>
          <View style={styles.row}>
            <Text style={[styles.rowLabel, { color: textMuted }]}>Email</Text>
            <Text style={[styles.rowValue, { color: textSub }]}>{email}</Text>
          </View>
        </View>

        {/* ── NEW: Appearance ── */}
        <View style={[styles.section, { backgroundColor: cardBg }]}>
          <Text style={[styles.sectionTitle, { color: accent }]}>Appearance</Text>
          <View style={styles.themeRow}>
            <TouchableOpacity
              style={[styles.themeBtn, { borderColor: border, backgroundColor: inputBg },
                activeMode === 'dark' && { backgroundColor: border, borderColor: accent }]}
              onPress={() => setThemeOverride('dark')}
            >
              <Text style={[styles.themeBtnText, { color: textMuted },
                activeMode === 'dark' && { color: accent, fontWeight: '600' }]}>
                🌙 Dark
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.themeBtn, { borderColor: border, backgroundColor: inputBg },
                activeMode === 'light' && { backgroundColor: border, borderColor: accent }]}
              onPress={() => setThemeOverride('light')}
            >
              <Text style={[styles.themeBtnText, { color: textMuted },
                activeMode === 'light' && { color: accent, fontWeight: '600' }]}>
                {'\u2600\ufe0f'} Light
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Alert Radius (original) ── */}
        <View style={[styles.section, { backgroundColor: cardBg }]}>
          <Text style={[styles.sectionTitle, { color: accent }]}>Alert Radius</Text>
          <View style={styles.radiusRow}>
            <Text style={[styles.rowLabel, { color: textMuted }]}>Notify me within</Text>
            <Text style={[styles.radiusValue, { color: accent }]}>{prefs.alert_radius_m}m</Text>
          </View>
          <Text style={[styles.hint, { color: textSub }]}>
            You will be alerted when ice is detected within this distance of your location
          </Text>
          <CustomSlider
            value={prefs.alert_radius_m}
            minimumValue={100}
            maximumValue={2000}
            step={100}
            onValueChange={v => setPref('alert_radius_m', v)}
          />
          <View style={styles.sliderLabels}>
            <Text style={[styles.sliderLabel, { color: textSub }]}>100m</Text>
            <Text style={[styles.sliderLabel, { color: textSub }]}>2km</Text>
          </View>
        </View>

        {/* ── Route Warning Threshold (original) ── */}
        <View style={[styles.section, { backgroundColor: cardBg }]}>
          <Text style={[styles.sectionTitle, { color: accent }]}>Route Warning Threshold</Text>
          <View style={styles.radiusRow}>
            <Text style={[styles.rowLabel, { color: textMuted }]}>Warn me</Text>
            <Text style={[styles.radiusValue, { color: accent }]}>{warnSeconds}s before ice</Text>
          </View>
          <Text style={[styles.hint, { color: textSub }]}>
            How far ahead the app warns you when your route is heading toward ice.
            At speed, the effective warn distance scales automatically (e.g. 10s × 14 m/s = 140m).
          </Text>
          <CustomSlider
            value={warnSeconds}
            minimumValue={5}
            maximumValue={30}
            step={5}
            onValueChange={v => setWarnSeconds(snapToStep(v))}
          />
          <View style={styles.sliderLabels}>
            <Text style={[styles.sliderLabel, { color: textSub }]}>5s</Text>
            <Text style={[styles.sliderLabel, { color: textSub }]}>30s</Text>
          </View>
        </View>

        {/* ── NEW: Confidence Filter ── */}
        <View style={[styles.section, { backgroundColor: cardBg }]}>
          <Text style={[styles.sectionTitle, { color: accent }]}>Confidence Filter</Text>
          <View style={styles.radiusRow}>
            <Text style={[styles.rowLabel, { color: textMuted }]}>Minimum confidence</Text>
            <Text style={[styles.radiusValue, { color: accent }]}>{Math.round((prefs.conf_min ?? 0) * 100)}%</Text>
          </View>
          <Text style={[styles.hint, { color: textSub }]}>
            Alerts below this confidence level are hidden on the map and list
          </Text>
          <CustomSlider
            value={(prefs.conf_min ?? 0) * 100}
            minimumValue={0}
            maximumValue={95}
            step={5}
            onValueChange={v => setPref('conf_min', v / 100)}
          />
          <View style={styles.sliderLabels}>
            <Text style={[styles.sliderLabel, { color: textSub }]}>0% (show all)</Text>
            <Text style={[styles.sliderLabel, { color: textSub }]}>95%</Text>
          </View>
        </View>

        {/* ── Alert Types (original) ── */}
        <View style={[styles.section, { backgroundColor: cardBg }]}>
          <Text style={[styles.sectionTitle, { color: accent }]}>Alert Types</Text>

          <View style={styles.toggleRow}>
            <View style={styles.toggleInfo}>
              <Text style={[styles.toggleLabel, { color: textPrim }]}>Ice Detection Alerts</Text>
              <Text style={[styles.toggleDesc, { color: textSub }]}>
                High-confidence black ice detected by the FrostByte sensor unit
              </Text>
            </View>
            <Switch
              value={prefs.notify_ice}
              onValueChange={v => setPref('notify_ice', v)}
              trackColor={{ false: '#333', true: '#0f3460' }}
              thumbColor="#fff"
            />
          </View>

          <View style={[styles.divider, { backgroundColor: border }]} />

          <View style={styles.toggleRow}>
            <View style={styles.toggleInfo}>
              <Text style={[styles.toggleLabel, { color: textPrim }]}>Route-Based Warnings</Text>
              <Text style={[styles.toggleDesc, { color: textSub }]}>
                Alert when your heading will bring you to an ice zone within your chosen threshold
              </Text>
            </View>
            <Switch
              value={prefs.notify_route}
              onValueChange={v => setPref('notify_route', v)}
              trackColor={{ false: '#333', true: '#0f3460' }}
              thumbColor="#fff"
            />
          </View>

          <View style={[styles.divider, { backgroundColor: border }]} />

          <View style={styles.toggleRow}>
            <View style={styles.toggleInfo}>
              <Text style={[styles.toggleLabel, { color: textPrim }]}>Bluetooth Proximity Alerts</Text>
              <Text style={[styles.toggleDesc, { color: textSub }]}>
                Detect nearby FrostByte devices via network scan (80m radius) or native Bluetooth in a standalone build
              </Text>
            </View>
            <Switch
              value={prefs.notify_bluetooth}
              onValueChange={v => setPref('notify_bluetooth', v)}
              trackColor={{ false: '#333', true: '#0f3460' }}
              thumbColor="#fff"
            />
          </View>
        </View>

        {/* ── Data and Privacy (original) ── */}
        <View style={[styles.section, { backgroundColor: cardBg }]}>
          <Text style={[styles.sectionTitle, { color: accent }]}>Data and Privacy</Text>
          <Text style={[styles.privacyText, { color: textSub }]}>
            Your email and password are stored securely on the FrostByte server and never shared.
            Your session token is stored encrypted on your device.
            Your preferences are stored on the FrostByte server and accessible only by your account.
            No location history is stored anywhere.
            Ice alerts are visible to all app users.
          </Text>
        </View>

        <TouchableOpacity style={[styles.saveButton, { backgroundColor: border }]} onPress={saveSettings} disabled={saving}>
          {saving
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.saveButtonText}>Save Settings</Text>
          }
        </TouchableOpacity>

        <TouchableOpacity style={styles.logoutButton} onPress={logout}>
          <Text style={styles.logoutText}>Sign Out</Text>
        </TouchableOpacity>

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container:          { flex: 1 },
  header:             { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1 },
  headerTitle:        { fontSize: 17, fontWeight: 'bold' },
  backBtn:            { paddingVertical: 4, paddingRight: 12, width: 60 },
  content:            { padding: 20, paddingBottom: 40 },
  loadingContainer:   { flex: 1, justifyContent: 'center', alignItems: 'center' },
  section:            { borderRadius: 12, padding: 16, marginBottom: 16 },
  sectionTitle:       { fontSize: 12, fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 },
  row:                { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  rowLabel:           { fontSize: 15 },
  rowValue:           { fontSize: 13, flexShrink: 1, textAlign: 'right', marginLeft: 8 },
  radiusRow:          { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  radiusValue:        { fontSize: 16, fontWeight: 'bold' },
  hint:               { fontSize: 12, marginBottom: 8 },
  sliderLabels:       { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  sliderLabel:        { fontSize: 11 },
  toggleRow:          { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 4 },
  toggleInfo:         { flex: 1, marginRight: 12 },
  toggleLabel:        { fontSize: 15, marginBottom: 3 },
  toggleDesc:         { fontSize: 12, lineHeight: 17 },
  divider:            { height: 1, marginVertical: 12 },
  privacyText:        { fontSize: 13, lineHeight: 20 },
  saveButton:         { borderRadius: 10, padding: 16, alignItems: 'center', marginBottom: 12 },
  saveButtonText:     { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  logoutButton:       { borderRadius: 10, padding: 16, alignItems: 'center', borderWidth: 1, borderColor: '#ff3b30' },
  logoutText:         { color: '#ff3b30', fontSize: 16, fontWeight: '600' },
  // NEW
  themeRow:           { flexDirection: 'row', gap: 10 },
  themeBtn:           { flex: 1, paddingVertical: 10, borderRadius: 8, borderWidth: 1, alignItems: 'center' },
  themeBtnText:       { fontSize: 14 },
});
