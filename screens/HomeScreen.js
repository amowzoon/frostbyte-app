import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ActivityIndicator, Alert, Platform
} from 'react-native';
import MapView, { Marker, Circle } from 'react-native-maps';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { supabase } from '../lib/supabase';
import { fetchAlerts, FetchSource } from '../lib/networkManager';
import { filterAlertsByRadius, getRouteAlerts } from '../lib/routeAlert';
import { scanForFrostByteDevices } from '../lib/bleManager';
import { useAuth } from '../context/AuthContext';
import { MaterialIcons } from '@expo/vector-icons';

const POLL_INTERVAL_MS = 30000;
const DEFAULT_RADIUS_M = 500;

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export default function HomeScreen({ navigation }) {
  const { logout, isGuest, userId } = useAuth();

  const [location, setLocation] = useState(null);
  const [heading, setHeading] = useState(null);
  const [speed, setSpeed] = useState(0);
  const [allAlerts, setAllAlerts] = useState([]);         // raw from network
  const [nearbyAlerts, setNearbyAlerts] = useState([]);   // proximity filtered
  const [routeAlerts, setRouteAlerts] = useState([]);     // route filtered
  const [bleAlerts, setBleAlerts] = useState([]);         // from BLE scan
  const [alertRadius, setAlertRadius] = useState(DEFAULT_RADIUS_M);
  const [prefs, setPrefs] = useState({ notify_ice: true, notify_bluetooth: true, notify_route: true });
  const [fetchSource, setFetchSource] = useState(FetchSource.NONE);
  const [cacheAge, setCacheAge] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);

  const mapRef = useRef(null);
  const pollTimer = useRef(null);
  const locationSub = useRef(null);
  const stopBleScan = useRef(null);

  // Load user preferences from Supabase
  useEffect(() => {
    if (!isGuest && userId) {
      supabase
        .from('user_preferences')
        .select('alert_radius_m, notify_ice, notify_bluetooth, notify_route')
        .eq('user_id', userId)
        .single()
        .then(({ data }) => {
          if (data?.alert_radius_m) setAlertRadius(data.alert_radius_m);
          if (data) setPrefs({
            notify_ice:       data.notify_ice       ?? true,
            notify_bluetooth: data.notify_bluetooth ?? true,
            notify_route:     data.notify_route     ?? true,
          });
        });
    }
  }, [userId, isGuest]);

  // Re-run client-side filtering whenever alerts, location, heading, or radius changes
  useEffect(() => {
    if (!location || allAlerts.length === 0) return;

    // Proximity filter — exact Haversine distance, not bounding box
    const nearby = filterAlertsByRadius(
      allAlerts,
      location.latitude,
      location.longitude,
      alertRadius,
      0  // include all confidence levels, let the map colors communicate risk
    );
    setNearbyAlerts(nearby);

    // Route-based filter — project path 60 seconds ahead
    const onRoute = getRouteAlerts(
      location.latitude,
      location.longitude,
      heading,
      speed,
      allAlerts,
      100,  // 100m alert zone radius around each ice detection
      60    // look 60 seconds ahead
    );
    setRouteAlerts(onRoute);

    // Route warning notification — only if user enabled route alerts
    if (prefs.notify_route && onRoute.length > 0 && onRoute[0].secondsUntilReach <= 15) {
      Notifications.scheduleNotificationAsync({
        content: {
          title: 'Ice ahead on your route',
          body: `Black ice detected approximately ${onRoute[0].secondsUntilReach} seconds ahead. Slow down.`,
        },
        trigger: null,
      });
    }
  }, [allAlerts, location, heading, speed, alertRadius, prefs]);

  useEffect(() => {
    setupPermissions();
    return () => {
      if (pollTimer.current) clearInterval(pollTimer.current);
      if (locationSub.current) locationSub.current.remove();
      if (stopBleScan.current) stopBleScan.current();
    };
  }, []);

  const setupPermissions = async () => {
    try {
      const { status: locStatus } = await Location.requestForegroundPermissionsAsync();
      if (locStatus !== 'granted') {
        Alert.alert('Location Required', 'FrostByte needs your location to show nearby ice alerts.');
        setLoading(false);
        return;
      }

      // Non-blocking notification permission
      Notifications.requestPermissionsAsync().then(async ({ status }) => {
        if (status === 'granted' && !isGuest) {
          try {
            // Push notifications require a development build — skip in Expo Go
            const pushToken = await Notifications.getExpoPushTokenAsync({
              projectId: 'frostbyte-alert-app',
            }).catch(() => null);
            if (pushToken) {
              await supabase
                .from('user_preferences')
                .upsert({ user_id: userId, push_token: pushToken.data }, { onConflict: 'user_id' });
            }
          } catch (e) {
            // Non-fatal — app works without push tokens in Expo Go
          }
        }
      });

      // Get initial location with timeout
      let coords = null;
      try {
        const locPromise = Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        const timeout = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), 8000)
        );
        const loc = await Promise.race([locPromise, timeout]);
        coords = loc.coords;
      } catch (e) {
        const last = await Location.getLastKnownPositionAsync();
        if (last) coords = last.coords;
      }

      setLocation(coords);
      setLoading(false);

      if (coords) {
        doFetch(coords);
      }

      // Watch location continuously for heading and speed (used for route alerting)
      locationSub.current = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.BestForNavigation,
          timeInterval: 2000,
          distanceInterval: 5,
        },
        (loc) => {
          setLocation(loc.coords);
          setHeading(loc.coords.heading);
          setSpeed(loc.coords.speed || 0);
        }
      );

      // Poll backend/Pi every 30 seconds
      pollTimer.current = setInterval(() => {
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
          .then(loc => doFetch(loc.coords))
          .catch(() => {});
      }, POLL_INTERVAL_MS);

      // Start BLE scan for nearby Pi devices
      startBleScan();

    } catch (err) {
      console.error('setupPermissions error:', err.message);
      setLoading(false);
    }
  };

  const doFetch = useCallback(async (coords) => {
    const result = await fetchAlerts(coords.latitude, coords.longitude, 2000);
    setAllAlerts(result.alerts);
    setFetchSource(result.source);
    setCacheAge(result.cacheAge);
    setLastUpdated(new Date());
  }, []);

  const startBleScan = () => {
    if (stopBleScan.current) stopBleScan.current();
    stopBleScan.current = scanForFrostByteDevices((device) => {
      setBleAlerts(prev => {
        const existing = prev.findIndex(a => a.deviceId === device.deviceId);
        if (existing >= 0) {
          const updated = [...prev];
          updated[existing] = device;
          return updated;
        }
        return [...prev, device];
      });
    }, 15000);
  };

  const getAlertColor = (confidence) => {
    if (confidence > 0.75) return '#ff3b30';
    if (confidence > 0.5)  return '#ff9500';
    return '#ffcc00';
  };

  const getSourceLabel = () => {
    switch (fetchSource) {
      case FetchSource.BACKEND:   return 'Local server';
      case FetchSource.SUPABASE:  return 'Live';
      case FetchSource.PI_PROXY:  return 'Direct from device';
      case FetchSource.CACHE:     return `Cached ${cacheAge}min ago`;
      case FetchSource.NONE:      return 'Offline';
      default:                    return '';
    }
  };

  const getSourceColor = () => {
    switch (fetchSource) {
      case FetchSource.BACKEND:   return '#1a2a3d';
      case FetchSource.SUPABASE:  return '#1a3d1a';
      case FetchSource.PI_PROXY:  return '#1a2a3d';
      case FetchSource.CACHE:     return '#3d3a1a';
      case FetchSource.NONE:      return '#3d1a1a';
      default:                    return '#1a1a2e';
    }
  };

  const centerOnUser = () => {
    if (location && mapRef.current) {
      mapRef.current.animateToRegion({
        latitude: location.latitude,
        longitude: location.longitude,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      }, 500);
    }
  };

  // Combine alert sources, filtered by user's alert type preferences
  const allMapAlerts = [
    ...(prefs.notify_ice ? nearbyAlerts : []),
    ...(prefs.notify_bluetooth ? bleAlerts.map(b => ({
      ...b,
      id: `ble-${b.deviceId}`,
      latitude: b.latitude,
      longitude: b.longitude,
    })) : []),
  ];

  const visibleRouteAlerts = prefs.notify_route ? routeAlerts : [];

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#4fc3f7" />
        <Text style={styles.loadingText}>Getting your location...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>

      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>FrostByte</Text>
          {isGuest && <Text style={styles.guestBadge}>Guest Mode</Text>}
        </View>
        <View style={styles.headerRight}>
          {!isGuest && (
            <TouchableOpacity onPress={() => navigation.navigate('Settings')} style={styles.headerBtn}>
              <Text style={styles.headerBtnText}>Settings</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={logout} style={styles.headerBtn}>
            <Text style={styles.headerBtnText}>{isGuest ? 'Sign In' : 'Sign Out'}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Status banner */}
      <View style={[styles.banner, { backgroundColor: getSourceColor() }]}>
        <View style={styles.bannerRow}>
          <Text style={styles.bannerText}>
            {allMapAlerts.length > 0
              ? `${allMapAlerts.length} alert${allMapAlerts.length > 1 ? 's' : ''} nearby`
              : 'No ice alerts in your area'
            }
            {bleAlerts.length > 0 ? `  (${bleAlerts.length} via Bluetooth)` : ''}
          </Text>
          <Text style={styles.sourceLabel}>{getSourceLabel()}</Text>
        </View>

        {/* Route alert warning */}
        {visibleRouteAlerts.length > 0 && (
          <Text style={styles.routeWarning}>
            Ice on your route — {visibleRouteAlerts[0].secondsUntilReach}s ahead
          </Text>
        )}

        {lastUpdated && (
          <Text style={styles.bannerSub}>
            Updated {lastUpdated.toLocaleTimeString()}
          </Text>
        )}
      </View>

      {/* Map */}
      <MapView
        ref={mapRef}
        style={styles.map}
        initialRegion={location ? {
          latitude: location.latitude,
          longitude: location.longitude,
          latitudeDelta: 0.02,
          longitudeDelta: 0.02,
        } : {
          latitude: 42.35,
          longitude: -71.06,
          latitudeDelta: 0.02,
          longitudeDelta: 0.02,
        }}
        showsUserLocation
        showsMyLocationButton={false}
      >
        {/* Nearby alerts from backend or Pi direct */}
        {allMapAlerts.map(alert => (
          <React.Fragment key={alert.id}>
            <Circle
              center={{ latitude: alert.latitude, longitude: alert.longitude }}
              radius={50}
              fillColor={getAlertColor(alert.confidence) + '40'}
              strokeColor={getAlertColor(alert.confidence)}
              strokeWidth={2}
            />
            <Marker
              coordinate={{ latitude: alert.latitude, longitude: alert.longitude }}
              title={alert.source === 'bluetooth' ? 'Ice Detected (Bluetooth)' : 'Black Ice Detected'}
              description={`Confidence: ${Math.round(alert.confidence * 100)}%${alert.distanceM ? `  Distance: ${Math.round(alert.distanceM)}m` : ''}`}
              pinColor={alert.source === 'bluetooth' ? '#4fc3f7' : getAlertColor(alert.confidence)}
            />
          </React.Fragment>
        ))}

        {/* Route alert zones — shown as larger circles in a distinct color */}
        {visibleRouteAlerts.map(alert => (
          <Circle
            key={`route-${alert.id}`}
            center={{ latitude: alert.latitude, longitude: alert.longitude }}
            radius={100}
            fillColor="#ff3b3020"
            strokeColor="#ff3b30"
            strokeWidth={3}
          />
        ))}
      </MapView>

      {/* Center on user button */}
      <TouchableOpacity style={styles.iconButton} onPress={centerOnUser} accessibilityLabel="Center map on my location">
        <MaterialIcons name="my-location" size={22} color="#fff" />
      </TouchableOpacity>

      {/* Bluetooth scan button */}
      <TouchableOpacity style={[styles.iconButton, styles.bleIconButton]} onPress={startBleScan} accessibilityLabel="Scan for nearby FrostByte devices via Bluetooth">
        <MaterialIcons name="bluetooth-searching" size={22} color="#4fc3f7" />
      </TouchableOpacity>

      {/* Legend */}
      <View style={styles.legend}>
        <Text style={styles.legendTitle}>Risk Level</Text>
        <View style={styles.legendRow}>
          <View style={[styles.legendDot, { backgroundColor: '#ff3b30' }]} />
          <Text style={styles.legendText}>High over 75%</Text>
        </View>
        <View style={styles.legendRow}>
          <View style={[styles.legendDot, { backgroundColor: '#ff9500' }]} />
          <Text style={styles.legendText}>Medium 50 to 75%</Text>
        </View>
        <View style={styles.legendRow}>
          <View style={[styles.legendDot, { backgroundColor: '#ffcc00' }]} />
          <Text style={styles.legendText}>Low under 50%</Text>
        </View>
        <View style={styles.legendRow}>
          <View style={[styles.legendDot, { backgroundColor: '#4fc3f7' }]} />
          <Text style={styles.legendText}>Bluetooth</Text>
        </View>
        {visibleRouteAlerts.length > 0 && (
          <View style={styles.legendRow}>
            <View style={[styles.legendDot, { backgroundColor: '#ff3b30', borderWidth: 2, borderColor: '#fff' }]} />
            <Text style={styles.legendText}>On your route</Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  loadingContainer: { flex: 1, backgroundColor: '#1a1a2e', justifyContent: 'center', alignItems: 'center' },
  loadingText: { color: '#888', marginTop: 12, fontSize: 14 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 52 : 40,
    paddingBottom: 12,
    backgroundColor: '#1a1a2e',
    zIndex: 10,
  },
  headerTitle: { color: '#fff', fontSize: 20, fontWeight: 'bold' },
  guestBadge: { color: '#4fc3f7', fontSize: 10, fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: 1 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  headerBtn: { paddingHorizontal: 8, paddingVertical: 4 },
  headerBtnText: { color: '#4fc3f7', fontSize: 14 },
  banner: { paddingVertical: 10, paddingHorizontal: 16 },
  bannerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  bannerText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  sourceLabel: { color: '#aaa', fontSize: 11 },
  routeWarning: { color: '#ff3b30', fontSize: 13, fontWeight: 'bold', marginTop: 4 },
  bannerSub: { color: '#888', fontSize: 11, marginTop: 2 },
  map: { flex: 1 },
  iconButton: {
    position: 'absolute',
    bottom: 200,
    right: 16,
    backgroundColor: '#1a1a2e',
    borderRadius: 28,
    width: 48,
    height: 48,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 4,
    elevation: 5,
    borderWidth: 1,
    borderColor: '#0f3460',
  },
  bleIconButton: {
    bottom: 260,
    backgroundColor: '#0f3460',
    borderColor: '#4fc3f7',
  },
  legend: {
    position: 'absolute',
    bottom: 40,
    left: 16,
    backgroundColor: 'rgba(26, 26, 46, 0.92)',
    borderRadius: 10,
    padding: 12,
    minWidth: 150,
  },
  legendTitle: { color: '#fff', fontSize: 12, fontWeight: 'bold', marginBottom: 6 },
  legendRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  legendDot: { width: 10, height: 10, borderRadius: 5, marginRight: 6 },
  legendText: { color: '#ccc', fontSize: 11 },
});
