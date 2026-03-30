import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ActivityIndicator, Alert, Switch, ScrollView
} from 'react-native';
import Slider from '@react-native-community/slider';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';

const DEFAULT_PREFS = {
  alert_radius_m: 500,
  notify_ice: true,
  notify_bluetooth: true,
  notify_route: true,
};

export default function SettingsScreen() {
  const { logout, email, userId } = useAuth();
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [prefs, setPrefs]       = useState(DEFAULT_PREFS);

  useEffect(() => { loadSettings(); }, []);

  const loadSettings = async () => {
    try {
      const { data, error } = await supabase
        .from('user_preferences')
        .select('alert_radius_m, notify_ice, notify_bluetooth, notify_route')
        .eq('user_id', userId)
        .single();

      if (error && error.code !== 'PGRST116') throw error;
      if (data) {
        setPrefs({
          alert_radius_m:   data.alert_radius_m   ?? DEFAULT_PREFS.alert_radius_m,
          notify_ice:       data.notify_ice       ?? DEFAULT_PREFS.notify_ice,
          notify_bluetooth: data.notify_bluetooth ?? DEFAULT_PREFS.notify_bluetooth,
          notify_route:     data.notify_route     ?? DEFAULT_PREFS.notify_route,
        });
      }
    } catch (err) {
      console.warn('Failed to load settings:', err.message);
    } finally {
      setLoading(false);
    }
  };

  const saveSettings = async () => {
    setSaving(true);
    try {
      const { error } = await supabase
        .from('user_preferences')
        .upsert({ user_id: userId, ...prefs, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
      if (error) throw error;
      Alert.alert('Saved', 'Your settings have been updated.');
    } catch (err) {
      Alert.alert('Error', 'Failed to save settings: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const setPref = (key, value) => setPrefs(prev => ({ ...prev, [key]: value }));

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#4fc3f7" />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>

      {/* Account */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Account</Text>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Email</Text>
          <Text style={styles.rowValue}>{email}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Session</Text>
          <Text style={styles.rowValue}>Managed by Supabase</Text>
        </View>
      </View>

      {/* Alert radius */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Alert Radius</Text>
        <View style={styles.radiusRow}>
          <Text style={styles.rowLabel}>Notify me within</Text>
          <Text style={styles.radiusValue}>{prefs.alert_radius_m}m</Text>
        </View>
        <Text style={styles.hint}>
          You will be alerted when ice is detected within this distance of your location
        </Text>
        <Slider
          style={styles.slider}
          minimumValue={100}
          maximumValue={2000}
          step={100}
          value={prefs.alert_radius_m}
          onValueChange={v => setPref('alert_radius_m', v)}
          minimumTrackTintColor="#4fc3f7"
          maximumTrackTintColor="#333"
          thumbTintColor="#4fc3f7"
        />
        <View style={styles.sliderLabels}>
          <Text style={styles.sliderLabel}>100m</Text>
          <Text style={styles.sliderLabel}>2km</Text>
        </View>
      </View>

      {/* Alert types */}
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
            thumbColor={prefs.notify_ice ? '#4fc3f7' : '#666'}
          />
        </View>

        <View style={styles.divider} />

        <View style={styles.toggleRow}>
          <View style={styles.toggleInfo}>
            <Text style={styles.toggleLabel}>Route-Based Warnings</Text>
            <Text style={styles.toggleDesc}>
              Alert when your current heading and speed will bring you to an ice zone within 60 seconds
            </Text>
          </View>
          <Switch
            value={prefs.notify_route}
            onValueChange={v => setPref('notify_route', v)}
            trackColor={{ false: '#333', true: '#0f3460' }}
            thumbColor={prefs.notify_route ? '#4fc3f7' : '#666'}
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
            thumbColor={prefs.notify_bluetooth ? '#4fc3f7' : '#666'}
          />
        </View>
      </View>

      {/* Data privacy */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Data and Privacy</Text>
        <Text style={styles.privacyText}>
          Your email and password are stored securely by Supabase and never touch the FrostByte server.
          Your session token is stored encrypted on your device.
          Your preferences are stored in Supabase and accessible only by your account.
          No location history is stored anywhere.
          Ice alerts are stored in Supabase and are visible to all app users.
        </Text>
      </View>

      {/* Save */}
      <TouchableOpacity style={styles.saveButton} onPress={saveSettings} disabled={saving}>
        {saving
          ? <ActivityIndicator color="#fff" />
          : <Text style={styles.saveButtonText}>Save Settings</Text>
        }
      </TouchableOpacity>

      {/* Sign out */}
      <TouchableOpacity style={styles.logoutButton} onPress={logout}>
        <Text style={styles.logoutText}>Sign Out</Text>
      </TouchableOpacity>

    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container:       { flex: 1, backgroundColor: '#1a1a2e' },
  content:         { padding: 20, paddingBottom: 40 },
  loadingContainer:{ flex: 1, backgroundColor: '#1a1a2e', justifyContent: 'center', alignItems: 'center' },
  section:         { backgroundColor: '#16213e', borderRadius: 12, padding: 16, marginBottom: 16 },
  sectionTitle:    { color: '#4fc3f7', fontSize: 12, fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 },
  row:             { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  rowLabel:        { color: '#ccc', fontSize: 15 },
  rowValue:        { color: '#888', fontSize: 13, flexShrink: 1, textAlign: 'right', marginLeft: 8 },
  radiusRow:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  radiusValue:     { color: '#4fc3f7', fontSize: 16, fontWeight: 'bold' },
  hint:            { color: '#666', fontSize: 12, marginBottom: 8 },
  slider:          { width: '100%', height: 40 },
  sliderLabels:    { flexDirection: 'row', justifyContent: 'space-between' },
  sliderLabel:     { color: '#666', fontSize: 11 },
  toggleRow:       { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 4 },
  toggleInfo:      { flex: 1, marginRight: 12 },
  toggleLabel:     { color: '#fff', fontSize: 15, marginBottom: 3 },
  toggleDesc:      { color: '#888', fontSize: 12, lineHeight: 17 },
  divider:         { height: 1, backgroundColor: '#0f3460', marginVertical: 12 },
  privacyText:     { color: '#888', fontSize: 13, lineHeight: 20 },
  saveButton:      { backgroundColor: '#0f3460', borderRadius: 10, padding: 16, alignItems: 'center', marginBottom: 12 },
  saveButtonText:  { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  logoutButton:    { borderRadius: 10, padding: 16, alignItems: 'center', borderWidth: 1, borderColor: '#ff3b30' },
  logoutText:      { color: '#ff3b30', fontSize: 16, fontWeight: '600' },
});
