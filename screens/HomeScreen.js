import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ActivityIndicator, Alert, Platform
} from 'react-native';
import MapView, { Marker, Circle } from 'react-native-maps';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import client from '../api/client';
import { useAuth } from '../context/AuthContext';

// How often to poll for nearby alerts (milliseconds)
const POLL_INTERVAL_MS = 30000;

// Configure notification handler
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export default function HomeScreen({ navigation }) {
  const { logout, isGuest } = useAuth();
  const [location, setLocation] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);
  const mapRef = useRef(null);
  const pollTimer = useRef(null);

  // Request permissions and get location
  useEffect(() => {
    setupPermissions();
    return () => {
      if (pollTimer.current) clearInterval(pollTimer.current);
    };
  }, []);

  const setupPermissions = async () => {
    try {
      // Location permission
      const { status: locStatus } = await Location.requestForegroundPermissionsAsync();
      if (locStatus !== 'granted') {
        Alert.alert(
          'Location Required',
          'FrostByte needs your location to show nearby ice alerts. Enable it in Settings.',
          [{ text: 'OK' }]
        );
        setLoading(false);
        return;
      }

      // Notification permission — non-blocking, don't await
      Notifications.requestPermissionsAsync().then(async ({ status }) => {
        if (status === 'granted') {
          try {
            const pushToken = await Notifications.getExpoPushTokenAsync();
            await client.post('/api/app/push-token', { push_token: pushToken.data });
          } catch (e) {
            console.warn('Push token registration failed:', e.message);
          }
        }
      });

      // Get location with timeout fallback
      let coords = null;
      try {
        const locPromise = Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), 8000)
        );
        const loc = await Promise.race([locPromise, timeoutPromise]);
        coords = loc.coords;
      } catch (e) {
        // Fall back to last known location
        console.warn('getCurrentPositionAsync timed out, trying last known location');
        try {
          const last = await Location.getLastKnownPositionAsync();
          if (last) coords = last.coords;
        } catch (e2) {
          console.warn('Last known location also failed:', e2.message);
        }
      }

      setLocation(coords);
      setLoading(false);

      if (coords) {
        fetchAlerts(coords);
      }

      // Poll for location updates
      pollTimer.current = setInterval(async () => {
        try {
          const l = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });
          setLocation(l.coords);
          fetchAlerts(l.coords);
        } catch (e) {
          console.warn('Poll location failed:', e.message);
        }
      }, POLL_INTERVAL_MS);

    } catch (err) {
      console.error('setupPermissions error:', err.message);
      setLoading(false);
    }
  };

  const fetchAlerts = useCallback(async (coords) => {
    if (!coords) return;
    try {
      const res = await client.get('/api/app/alerts/nearby', {
        params: {
          lat: coords.latitude,
          lon: coords.longitude,
          radius_m: 1000,
        },
      });
      const newAlerts = res.data.alerts || [];
      setAlerts(newAlerts);
      setLastUpdated(new Date());

      // Local notification if high-confidence alert is very close
      const critical = newAlerts.find(a => a.confidence > 0.75);
      if (critical) {
        await Notifications.scheduleNotificationAsync({
          content: {
            title: '⚠️ Black Ice Nearby',
            body: `High confidence ice detected ${Math.round(critical.confidence * 100)}% — proceed with caution.`,
          },
          trigger: null, // show immediately
        });
      }
    } catch (err) {
      console.warn('Failed to fetch alerts:', err.message);
    }
  }, []);

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

  const getAlertColor = (confidence) => {
    if (confidence > 0.75) return '#ff3b30';  // red — high
    if (confidence > 0.5)  return '#ff9500';  // orange — medium
    return '#ffcc00';                           // yellow — low
  };

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
          <Text style={styles.headerTitle}>❄️ FrostByte</Text>
          {isGuest && <Text style={styles.guestBadge}>Guest Mode</Text>}
        </View>
        <View style={styles.headerRight}>
          {!isGuest && (
            <TouchableOpacity onPress={() => navigation.navigate('Settings')} style={styles.headerBtn}>
              <Text style={styles.headerBtnText}>⚙️</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={logout} style={styles.headerBtn}>
            <Text style={styles.headerBtnText}>{isGuest ? 'Sign In' : 'Sign Out'}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Alert count banner */}
      <View style={[styles.banner, alerts.length > 0 ? styles.bannerAlert : styles.bannerSafe]}>
        <Text style={styles.bannerText}>
          {alerts.length > 0
            ? `⚠️  ${alerts.length} ice alert${alerts.length > 1 ? 's' : ''} within 1km`
            : '✅  No ice alerts in your area'
          }
        </Text>
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
        mapType="standard"
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
        {/* Ice alert markers */}
        {alerts.map(alert => (
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
              title="Black Ice Detected"
              description={`Confidence: ${Math.round(alert.confidence * 100)}%`}
              pinColor={getAlertColor(alert.confidence)}
            />
          </React.Fragment>
        ))}
      </MapView>

      {/* Center on user button */}
      <TouchableOpacity style={styles.locButton} onPress={centerOnUser}>
        <Text style={styles.locButtonText}>📍</Text>
      </TouchableOpacity>

      {/* Legend */}
      <View style={styles.legend}>
        <Text style={styles.legendTitle}>Risk Level</Text>
        <View style={styles.legendRow}>
          <View style={[styles.legendDot, { backgroundColor: '#ff3b30' }]} />
          <Text style={styles.legendText}>High (&gt;75%)</Text>
        </View>
        <View style={styles.legendRow}>
          <View style={[styles.legendDot, { backgroundColor: '#ff9500' }]} />
          <Text style={styles.legendText}>Medium (50–75%)</Text>
        </View>
        <View style={styles.legendRow}>
          <View style={[styles.legendDot, { backgroundColor: '#ffcc00' }]} />
          <Text style={styles.legendText}>Low (&lt;50%)</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: '#1a1a2e',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: '#888',
    marginTop: 12,
    fontSize: 14,
  },
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
  headerTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headerBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  headerBtnText: {
    color: '#4fc3f7',
    fontSize: 14,
  },
  banner: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  bannerAlert: {
    backgroundColor: '#3d1a1a',
  },
  bannerSafe: {
    backgroundColor: '#1a3d1a',
  },
  bannerText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  bannerSub: {
    color: '#888',
    fontSize: 11,
    marginTop: 2,
  },
  map: {
    flex: 1,
  },
  locButton: {
    position: 'absolute',
    bottom: 180,
    right: 16,
    backgroundColor: '#1a1a2e',
    borderRadius: 30,
    width: 50,
    height: 50,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 4,
    elevation: 5,
  },
  locButtonText: {
    fontSize: 22,
  },
  guestBadge: {
    color: '#4fc3f7',
    fontSize: 10,
    fontWeight: 'bold',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  legend: {
    position: 'absolute',
    bottom: 40,
    left: 16,
    backgroundColor: 'rgba(26, 26, 46, 0.92)',
    borderRadius: 10,
    padding: 12,
    minWidth: 140,
  },
  legendTitle: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
    marginBottom: 6,
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 6,
  },
  legendText: {
    color: '#ccc',
    fontSize: 11,
  },
});