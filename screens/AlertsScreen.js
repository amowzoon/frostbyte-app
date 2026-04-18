import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ScrollView, ActivityIndicator, RefreshControl, Platform
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import client from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext'; // NEW

function formatTime(iso) {
  const d = new Date(iso);
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function ConfidenceDot({ confidence }) {
  const color = confidence > 0.75 ? '#ff3b30' : confidence > 0.5 ? '#ff9500' : '#ffcc00';
  return <View style={[dotStyles.dot, { backgroundColor: color }]} />;
}

const dotStyles = StyleSheet.create({
  dot: { width: 10, height: 10, borderRadius: 5, marginRight: 8, marginTop: 3 },
});

export default function AlertsScreen({ navigation }) {
  const { prefs } = useAuth();
  const { theme } = useTheme();

  const [alerts, setAlerts] = useState([]);
  const [devices, setDevices] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [alertsRes, devicesRes, statsRes] = await Promise.all([
        client.get('/api/app/alerts/history', { params: { period: 'today' } }),
        client.get('/api/app/devices'),
        client.get('/api/app/stats', { params: { period: 'today' } }),
      ]);
      setAlerts(alertsRes.data.alerts || []);
      setDevices(devicesRes.data.devices || []);
      setStats(statsRes.data);
    } catch (err) {
      console.warn('Failed to load alerts screen:', err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, []);

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  // NEW: theme-driven colors
  const bg        = theme.mode === 'light' ? '#f0f2f5' : '#1a1a2e';
  const cardBg    = theme.mode === 'light' ? '#ffffff' : '#16213e';
  const inputBg   = theme.mode === 'light' ? '#e8eaed' : '#0f1b2d';
  const border    = theme.mode === 'light' ? '#d0d7de' : '#0f3460';
  const textPrim  = theme.mode === 'light' ? '#1f2328' : '#ffffff';
  const textMuted = theme.mode === 'light' ? '#57606a' : '#888888';
  const textSub   = theme.mode === 'light' ? '#8c959f' : '#555555';
  const accent    = '#4fc3f7';

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: bg }]}>
      <View style={[styles.header, { backgroundColor: bg, borderBottomColor: border }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <MaterialIcons name="arrow-back" size={22} color={accent} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: textPrim }]}>Alert Dashboard</Text>
        <View style={{ width: 44 }} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={accent} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={accent} />}
        >

          {/* Stats */}
          {stats && (
            <View style={[styles.section, { backgroundColor: cardBg }]}>
              <Text style={[styles.sectionTitle, { color: accent }]}>Statistics</Text>
              <View style={styles.statsGrid}>
                <View style={[styles.statCard, { backgroundColor: inputBg }]}>
                  <Text style={[styles.statNumber, { color: textPrim }]}>{stats.total_alerts}</Text>
                  <Text style={[styles.statLabel, { color: textMuted }]}>Total alerts</Text>
                </View>
                <View style={[styles.statCard, { backgroundColor: inputBg }]}>
                  <Text style={[styles.statNumber, { color: textPrim }]}>{stats.unique_devices}</Text>
                  <Text style={[styles.statLabel, { color: textMuted }]}>Devices active</Text>
                </View>
                <View style={[styles.statCard, { backgroundColor: inputBg }]}>
                  <Text style={[styles.statNumber, { color: textPrim }]}>
                    {stats.avg_confidence ? `${Math.round(stats.avg_confidence * 100)}%` : '—'}
                  </Text>
                  <Text style={[styles.statLabel, { color: textMuted }]}>Avg confidence</Text>
                </View>
                <View style={[styles.statCard, { backgroundColor: inputBg }]}>
                  <Text style={[styles.statNumber, { color: textPrim }]}>{stats.high_confidence_alerts}</Text>
                  <Text style={[styles.statLabel, { color: textMuted }]}>High risk alerts</Text>
                </View>
              </View>
            </View>
          )}

          {/* Device statuses */}
          <View style={[styles.section, { backgroundColor: cardBg }]}>
            <Text style={[styles.sectionTitle, { color: accent }]}>Device Status</Text>
            {devices.length === 0 ? (
              <Text style={[styles.emptyText, { color: textSub }]}>No devices have reported recently.</Text>
            ) : (
              devices.map((d, i) => (
                <View key={d.device_id} style={[styles.deviceRow,
                  i < devices.length - 1 && { borderBottomWidth: 1, borderBottomColor: border }]}>
                  <View style={[styles.statusDot, { backgroundColor: d.is_active ? '#30d158' : textSub }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.deviceId, { color: textPrim }]}>{d.device_id}</Text>
                    <Text style={[styles.deviceSub, { color: textMuted }]}>
                      Last seen {formatTime(d.last_seen)} · {d.total_alerts} alert{d.total_alerts !== 1 ? 's' : ''}
                    </Text>
                  </View>
                  <Text style={[styles.deviceStatus, { color: d.is_active ? '#30d158' : textSub }]}>
                    {d.is_active ? 'Active' : 'Offline'}
                  </Text>
                </View>
              ))
            )}
          </View>

          {/* Past alerts */}
          <View style={[styles.section, { backgroundColor: cardBg }]}>
            <Text style={[styles.sectionTitle, { color: accent }]}>
              Alert History{alerts.length > 0 ? ` (${alerts.length})` : ''}
            </Text>
            {alerts.length === 0 ? (
              <Text style={[styles.emptyText, { color: textSub }]}>No alerts recorded for this period.</Text>
            ) : (
              alerts.map((a, i) => (
                <View key={a.id} style={[styles.alertRow,
                  i < alerts.length - 1 && { borderBottomWidth: 1, borderBottomColor: border }]}>
                  <ConfidenceDot confidence={a.confidence} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.alertDevice, { color: textPrim }]}>{a.device_id || 'unknown device'}</Text>
                    <Text style={[styles.alertCoords, { color: textMuted }]}>
                      {Number(a.latitude).toFixed(5)}, {Number(a.longitude).toFixed(5)}
                    </Text>
                    <Text style={[styles.alertTime, { color: textSub }]}>{formatTime(a.created_at)}</Text>
                  </View>
                  <Text style={[styles.alertConf, { color: accent }]}>{Math.round(a.confidence * 100)}%</Text>
                </View>
              ))
            )}
          </View>

        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container:         { flex: 1 },
  header:            { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1 },
  headerTitle:       { fontSize: 17, fontWeight: 'bold' },
  backBtn:           { paddingVertical: 4, paddingRight: 12, width: 44 },
  periodRow:         { flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 10, gap: 8 },
  periodBtn:         { flex: 1, paddingVertical: 7, borderRadius: 8, alignItems: 'center', borderWidth: 1 },
  periodLabel:       { fontSize: 12, fontWeight: '600' },
  center:            { flex: 1, justifyContent: 'center', alignItems: 'center' },
  content:           { padding: 16, paddingBottom: 40 },
  section:           { borderRadius: 12, padding: 16, marginBottom: 16 },
  sectionTitle:      { fontSize: 12, fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 },
  statsGrid:         { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  statCard:          { flex: 1, minWidth: '44%', borderRadius: 10, padding: 14, alignItems: 'center' },
  statNumber:        { fontSize: 26, fontWeight: 'bold', marginBottom: 4 },
  statLabel:         { fontSize: 11, textAlign: 'center' },
  deviceRow:         { flexDirection: 'row', alignItems: 'center', paddingVertical: 10 },
  statusDot:         { width: 10, height: 10, borderRadius: 5, marginRight: 10 },
  deviceId:          { fontSize: 14, fontWeight: '600' },
  deviceSub:         { fontSize: 11, marginTop: 2 },
  deviceStatus:      { fontSize: 12, fontWeight: '600' },
  alertRow:          { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 10 },
  alertDevice:       { fontSize: 13, fontWeight: '600' },
  alertCoords:       { fontSize: 11, marginTop: 2 },
  alertTime:         { fontSize: 11, marginTop: 2 },
  alertConf:         { fontSize: 13, fontWeight: 'bold', marginLeft: 8 },
  emptyText:         { fontSize: 13, fontStyle: 'italic' },
});
