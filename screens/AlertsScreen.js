import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ScrollView, ActivityIndicator, RefreshControl, Platform
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import client from '../api/client';
import { useAuth } from '../context/AuthContext';

const PERIODS = [
  { label: 'Today',     value: 'today' },
  { label: 'This week', value: 'week'  },
  { label: 'This month',value: 'month' },
];

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
  const [period, setPeriod] = useState('today');
  const [alerts, setAlerts] = useState([]);
  const [devices, setDevices] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (p = period) => {
    try {
      const [alertsRes, devicesRes, statsRes] = await Promise.all([
        client.get('/api/app/alerts/history', { params: { period: p } }),
        client.get('/api/app/devices'),
        client.get('/api/app/stats', { params: { period: p } }),
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
  }, [period]);

  useEffect(() => { load(); }, []);

  const onPeriodChange = (p) => {
    setPeriod(p);
    setLoading(true);
    load(p);
  };

  const onRefresh = () => {
    setRefreshing(true);
    load(period);
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <MaterialIcons name="arrow-back" size={22} color="#4fc3f7" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Alert Dashboard</Text>
        <View style={{ width: 44 }} />
      </View>

      {/* Period selector */}
      <View style={styles.periodRow}>
        {PERIODS.map(p => (
          <TouchableOpacity
            key={p.value}
            style={[styles.periodBtn, period === p.value && styles.periodBtnActive]}
            onPress={() => onPeriodChange(p.value)}
          >
            <Text style={[styles.periodLabel, period === p.value && styles.periodLabelActive]}>
              {p.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#4fc3f7" />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#4fc3f7" />}
        >

          {/* Stats */}
          {stats && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Statistics</Text>
              <View style={styles.statsGrid}>
                <View style={styles.statCard}>
                  <Text style={styles.statNumber}>{stats.total_alerts}</Text>
                  <Text style={styles.statLabel}>Total alerts</Text>
                </View>
                <View style={styles.statCard}>
                  <Text style={styles.statNumber}>{stats.unique_devices}</Text>
                  <Text style={styles.statLabel}>Devices active</Text>
                </View>
                <View style={styles.statCard}>
                  <Text style={styles.statNumber}>
                    {stats.avg_confidence ? `${Math.round(stats.avg_confidence * 100)}%` : '—'}
                  </Text>
                  <Text style={styles.statLabel}>Avg confidence</Text>
                </View>
                <View style={styles.statCard}>
                  <Text style={styles.statNumber}>{stats.high_confidence_alerts}</Text>
                  <Text style={styles.statLabel}>High risk alerts</Text>
                </View>
              </View>
            </View>
          )}

          {/* Device statuses */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Device Status</Text>
            {devices.length === 0 ? (
              <Text style={styles.emptyText}>No devices have reported recently.</Text>
            ) : (
              devices.map((d, i) => (
                <View key={d.device_id} style={[styles.deviceRow, i < devices.length - 1 && styles.rowBorder]}>
                  <View style={[styles.statusDot, { backgroundColor: d.is_active ? '#30d158' : '#888' }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.deviceId}>{d.device_id}</Text>
                    <Text style={styles.deviceSub}>
                      Last seen {formatTime(d.last_seen)} · {d.total_alerts} alert{d.total_alerts !== 1 ? 's' : ''}
                    </Text>
                  </View>
                  <Text style={[styles.deviceStatus, { color: d.is_active ? '#30d158' : '#888' }]}>
                    {d.is_active ? 'Active' : 'Offline'}
                  </Text>
                </View>
              ))
            )}
          </View>

          {/* Past alerts */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>
              Alert History{alerts.length > 0 ? ` (${alerts.length})` : ''}
            </Text>
            {alerts.length === 0 ? (
              <Text style={styles.emptyText}>No alerts recorded for this period.</Text>
            ) : (
              alerts.map((a, i) => (
                <View key={a.id} style={[styles.alertRow, i < alerts.length - 1 && styles.rowBorder]}>
                  <ConfidenceDot confidence={a.confidence} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.alertDevice}>{a.device_id || 'unknown device'}</Text>
                    <Text style={styles.alertCoords}>
                      {Number(a.latitude).toFixed(5)}, {Number(a.longitude).toFixed(5)}
                    </Text>
                    <Text style={styles.alertTime}>{formatTime(a.created_at)}</Text>
                  </View>
                  <Text style={styles.alertConf}>{Math.round(a.confidence * 100)}%</Text>
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
  container:       { flex: 1, backgroundColor: '#1a1a2e' },
  header:          { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#0f3460' },
  headerTitle:     { color: '#fff', fontSize: 17, fontWeight: 'bold' },
  backBtn:         { paddingVertical: 4, paddingRight: 12, width: 44 },
  periodRow:       { flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 10, gap: 8 },
  periodBtn:       { flex: 1, paddingVertical: 7, borderRadius: 8, backgroundColor: '#16213e', alignItems: 'center', borderWidth: 1, borderColor: '#0f3460' },
  periodBtnActive: { backgroundColor: '#0f3460', borderColor: '#4fc3f7' },
  periodLabel:     { color: '#888', fontSize: 12, fontWeight: '600' },
  periodLabelActive: { color: '#4fc3f7' },
  center:          { flex: 1, justifyContent: 'center', alignItems: 'center' },
  content:         { padding: 16, paddingBottom: 40 },
  section:         { backgroundColor: '#16213e', borderRadius: 12, padding: 16, marginBottom: 16 },
  sectionTitle:    { color: '#4fc3f7', fontSize: 12, fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 },
  statsGrid:       { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  statCard:        { flex: 1, minWidth: '44%', backgroundColor: '#0f1b2d', borderRadius: 10, padding: 14, alignItems: 'center' },
  statNumber:      { color: '#fff', fontSize: 26, fontWeight: 'bold', marginBottom: 4 },
  statLabel:       { color: '#888', fontSize: 11, textAlign: 'center' },
  deviceRow:       { flexDirection: 'row', alignItems: 'center', paddingVertical: 10 },
  rowBorder:       { borderBottomWidth: 1, borderBottomColor: '#0f3460' },
  statusDot:       { width: 10, height: 10, borderRadius: 5, marginRight: 10 },
  deviceId:        { color: '#fff', fontSize: 14, fontWeight: '600' },
  deviceSub:       { color: '#666', fontSize: 11, marginTop: 2 },
  deviceStatus:    { fontSize: 12, fontWeight: '600' },
  alertRow:        { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 10 },
  alertDevice:     { color: '#fff', fontSize: 13, fontWeight: '600' },
  alertCoords:     { color: '#888', fontSize: 11, marginTop: 2 },
  alertTime:       { color: '#555', fontSize: 11, marginTop: 2 },
  alertConf:       { color: '#4fc3f7', fontSize: 13, fontWeight: 'bold', marginLeft: 8 },
  emptyText:       { color: '#555', fontSize: 13, fontStyle: 'italic' },
});