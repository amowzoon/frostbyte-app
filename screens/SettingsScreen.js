import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ActivityIndicator, Alert, Switch
} from 'react-native';
import Slider from '@react-native-community/slider';
import client from '../api/client';
import { useAuth } from '../context/AuthContext';

export default function SettingsScreen() {
  const { logout } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [alertRadius, setAlertRadius] = useState(500);
  const [email, setEmail] = useState('');

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const res = await client.get('/api/app/settings');
      setAlertRadius(res.data.alert_radius_m || 500);
      setEmail(res.data.email || '');
    } catch (err) {
      console.warn('Failed to load settings:', err.message);
    } finally {
      setLoading(false);
    }
  };

  const saveSettings = async () => {
    setSaving(true);
    try {
      await client.patch('/api/app/settings', { alert_radius_m: alertRadius });
      Alert.alert('Saved', 'Your settings have been updated.');
    } catch (err) {
      Alert.alert('Error', 'Failed to save settings.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#4fc3f7" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Account */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Account</Text>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Email</Text>
          <Text style={styles.rowValue}>{email}</Text>
        </View>
      </View>

      {/* Alert radius */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Alert Settings</Text>
        <View style={styles.radiusRow}>
          <Text style={styles.rowLabel}>Alert Radius</Text>
          <Text style={styles.radiusValue}>{alertRadius}m</Text>
        </View>
        <Text style={styles.sliderHint}>
          You'll be alerted when ice is detected within this distance
        </Text>
        <Slider
          style={styles.slider}
          minimumValue={100}
          maximumValue={2000}
          step={100}
          value={alertRadius}
          onValueChange={setAlertRadius}
          minimumTrackTintColor="#4fc3f7"
          maximumTrackTintColor="#333"
          thumbTintColor="#4fc3f7"
        />
        <View style={styles.sliderLabels}>
          <Text style={styles.sliderLabel}>100m</Text>
          <Text style={styles.sliderLabel}>2km</Text>
        </View>
      </View>

      {/* Save button */}
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
    padding: 20,
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: '#1a1a2e',
    justifyContent: 'center',
    alignItems: 'center',
  },
  section: {
    backgroundColor: '#16213e',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  sectionTitle: {
    color: '#4fc3f7',
    fontSize: 12,
    fontWeight: 'bold',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 12,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  rowLabel: {
    color: '#ccc',
    fontSize: 15,
  },
  rowValue: {
    color: '#888',
    fontSize: 15,
  },
  radiusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  radiusValue: {
    color: '#4fc3f7',
    fontSize: 16,
    fontWeight: 'bold',
  },
  sliderHint: {
    color: '#666',
    fontSize: 12,
    marginBottom: 8,
  },
  slider: {
    width: '100%',
    height: 40,
  },
  sliderLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  sliderLabel: {
    color: '#666',
    fontSize: 11,
  },
  saveButton: {
    backgroundColor: '#0f3460',
    borderRadius: 10,
    padding: 16,
    alignItems: 'center',
    marginBottom: 12,
  },
  saveButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  logoutButton: {
    borderRadius: 10,
    padding: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#ff3b30',
  },
  logoutText: {
    color: '#ff3b30',
    fontSize: 16,
    fontWeight: '600',
  },
});