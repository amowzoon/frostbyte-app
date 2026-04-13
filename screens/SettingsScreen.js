import React, { useState, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ActivityIndicator, Alert, Switch, ScrollView, Platform
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { registerBackgroundAlertTask } from '../lib/backgroundAlertTask';
import { useAuth } from '../context/AuthContext';
import { MaterialIcons } from '@expo/vector-icons';
import client from '../api/client';

const snapToStep = (v) => Math.round(v / 5) * 5;
const THUMB = 28;
const TRACK_H = 4;

function CustomSlider({ value, minimumValue, maximumValue, step, onValueChange }) {
  const trackRef = useRef(null);
  const trackPageXRef = useRef(0);
  const trackWidthRef = useRef(0);
  const isDragging = useRef(false);
  const [thumbPct, setThumbPct] = useState(null);
  const [layoutDone, setLayoutDone] = useState(false);

  const clamp = (v) => Math.max(minimumValue, Math.min(maximumValue, v));
  const toPercent = (v) => (clamp(v) - minimumValue) / (maximumValue - minimumValue);
  const toValue = (pct) => {
    const raw = minimumValue + Math.max(0, Math.min(1, pct)) * (maximumValue - minimumValue);
    return step ? Math.round(raw / step) * step : raw;
  };

  const measure = (cb) => {
    if (trackRef.current) {
      trackRef.current.measure((x, y, w, h, pageX) => {
        trackPageXRef.current = pageX;
        trackWidthRef.current = w;
        if (cb) cb(w);
      });
    }
  };

  const onLayout = () => {
    measure((w) => {
      setThumbPct(toPercent(value));
      setLayoutDone(true);
    });
  };

  // Only sync from parent after layout is done and not dragging
  React.useEffect(() => {
    if (layoutDone && !isDragging.current) {
      setThumbPct(toPercent(value));
    }
  }, [value, layoutDone]);

  const handleTouch = (pageX) => {
    const w = trackWidthRef.current;
    if (!w) return;
    const pct = Math.max(0, Math.min(1, (pageX - trackPageXRef.current) / w));
    setThumbPct(pct);
    onValueChange && onValueChange(toValue(pct));
  };

  const handlers = {
    onStartShouldSetResponder: () => true,
    onMoveShouldSetResponder: () => true,
    onResponderGrant: (e) => {
      isDragging.current = true;
      measure();
      handleTouch(e.nativeEvent.pageX);
    },
    onResponderMove: (e) => {
      handleTouch(e.nativeEvent.pageX);
    },
    onResponderRelease: () => { isDragging.current = false; },
    onResponderTerminate: () => { isDragging.current = false; },
    onResponderTerminationRequest: () => false,
  };

  const pct = thumbPct ?? toPercent(value);
  const thumbLeft = layoutDone ? pct * (trackWidthRef.current - THUMB) : null;

  return (
    <View ref={trackRef} style={csStyles.container} onLayout={onLayout} {...handlers}>
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

  if (!prefsLoaded) {
    return (
      <SafeAreaView style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#4fc3f7" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <MaterialIcons name="arrow-back" size={22} color="#4fc3f7" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Settings</Text>
        <View style={{ width: 60 }} />
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Account</Text>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Email</Text>
          <Text style={styles.rowValue}>{email}</Text>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Alert Radius</Text>
        <View style={styles.radiusRow}>
          <Text style={styles.rowLabel}>Notify me within</Text>
          <Text style={styles.radiusValue}>{prefs.alert_radius_m}m</Text>
        </View>
        <Text style={styles.hint}>
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
          <Text style={styles.sliderLabel}>100m</Text>
          <Text style={styles.sliderLabel}>2km</Text>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Route Warning Threshold</Text>
        <View style={styles.radiusRow}>
          <Text style={styles.rowLabel}>Warn me</Text>
          <Text style={styles.radiusValue}>{warnSeconds}s before ice</Text>
        </View>
        <Text style={styles.hint}>
          How far ahead the app warns you when your route is heading toward ice
        </Text>
        <CustomSlider
          value={warnSeconds}
          minimumValue={5}
          maximumValue={30}
          step={5}
          onValueChange={v => setWarnSeconds(snapToStep(v))}
        />
        <View style={styles.sliderLabels}>
          <Text style={styles.sliderLabel}>5s</Text>
          <Text style={styles.sliderLabel}>30s</Text>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Alert Types</Text>

        <View style={styles.toggleRow}>
          <View style={styles.toggleInfo}>
            <Text style={styles.toggleLabel}>Ice Detection Alerts</Text>
            <Text style={styles.toggleDesc}>
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

        <View style={styles.divider} />

        <View style={styles.toggleRow}>
          <View style={styles.toggleInfo}>
            <Text style={styles.toggleLabel}>Route-Based Warnings</Text>
            <Text style={styles.toggleDesc}>
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

        <View style={styles.divider} />

        <View style={styles.toggleRow}>
          <View style={styles.toggleInfo}>
            <Text style={styles.toggleLabel}>Bluetooth Proximity Alerts</Text>
            <Text style={styles.toggleDesc}>
              Detect nearby FrostByte devices directly over Bluetooth — works without internet
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

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Data and Privacy</Text>
        <Text style={styles.privacyText}>
          Your email and password are stored securely on the FrostByte server and never shared.
          Your session token is stored encrypted on your device.
          Your preferences are stored on the FrostByte server and accessible only by your account.
          No location history is stored anywhere.
          Ice alerts are visible to all app users.
        </Text>
      </View>

      <TouchableOpacity style={styles.saveButton} onPress={saveSettings} disabled={saving}>
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
  container:        { flex: 1, backgroundColor: '#1a1a2e' },
  header:           { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#0f3460' },
  headerTitle:      { color: '#fff', fontSize: 17, fontWeight: 'bold' },
  backBtn:          { paddingVertical: 4, paddingRight: 12, width: 60 },
  content:          { padding: 20, paddingBottom: 40 },
  loadingContainer: { flex: 1, backgroundColor: '#1a1a2e', justifyContent: 'center', alignItems: 'center' },
  section:          { backgroundColor: '#16213e', borderRadius: 12, padding: 16, marginBottom: 16 },
  sectionTitle:     { color: '#4fc3f7', fontSize: 12, fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 },
  row:              { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  rowLabel:         { color: '#ccc', fontSize: 15 },
  rowValue:         { color: '#888', fontSize: 13, flexShrink: 1, textAlign: 'right', marginLeft: 8 },
  radiusRow:        { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  radiusValue:      { color: '#4fc3f7', fontSize: 16, fontWeight: 'bold' },
  hint:             { color: '#666', fontSize: 12, marginBottom: 8 },
  sliderLabels:     { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  sliderLabel:      { color: '#666', fontSize: 11 },
  toggleRow:        { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 4 },
  toggleInfo:       { flex: 1, marginRight: 12 },
  toggleLabel:      { color: '#fff', fontSize: 15, marginBottom: 3 },
  toggleDesc:       { color: '#888', fontSize: 12, lineHeight: 17 },
  divider:          { height: 1, backgroundColor: '#0f3460', marginVertical: 12 },
  privacyText:      { color: '#888', fontSize: 13, lineHeight: 20 },
  saveButton:       { backgroundColor: '#0f3460', borderRadius: 10, padding: 16, alignItems: 'center', marginBottom: 12 },
  saveButtonText:   { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  logoutButton:     { borderRadius: 10, padding: 16, alignItems: 'center', borderWidth: 1, borderColor: '#ff3b30' },
  logoutText:       { color: '#ff3b30', fontSize: 16, fontWeight: '600' },
});