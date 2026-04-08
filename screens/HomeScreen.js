import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ActivityIndicator, Alert, Platform, TextInput,
  FlatList, Keyboard
} from 'react-native';
import MapView, { Marker, Circle, Polyline } from 'react-native-maps';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { fetchAlerts, FetchSource } from '../lib/networkManager';
import client from '../api/client';
import { filterAlertsByRadius, getRouteAlerts, updateHeadingHistory, resetHeadingHistory } from '../lib/routeAlert';
import { scanForFrostByteDevices } from '../lib/bleManager';
import { useAuth } from '../context/AuthContext';
import { MaterialIcons } from '@expo/vector-icons';
import { searchPlaces, fetchRoute, checkRouteForIce, splitRouteSegments } from '../lib/routeNav';
import AsyncStorage from '@react-native-async-storage/async-storage';

const POLL_INTERVAL_MS = 30000;
const DEFAULT_RADIUS_M = 500;
const DEFAULT_WARN_SECONDS = 10;

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
  const [allAlerts, setAllAlerts] = useState([]);
  const [nearbyAlerts, setNearbyAlerts] = useState([]);
  const [routeAlerts, setRouteAlerts] = useState([]);
  const [bleAlerts, setBleAlerts] = useState([]);
  const [alertRadius, setAlertRadius] = useState(DEFAULT_RADIUS_M);
  const [warnSeconds, setWarnSeconds] = useState(DEFAULT_WARN_SECONDS);
  const [prefs, setPrefs] = useState({ notify_ice: true, notify_bluetooth: true, notify_route: true });
  const [fetchSource, setFetchSource] = useState(FetchSource.NONE);
  const [cacheAge, setCacheAge] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);

  // Destination search
  const [destQuery, setDestQuery] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);

  // Navigation route
  const [routeCoords, setRouteCoords] = useState(null);
  const [routeIceAlerts, setRouteIceAlerts] = useState([]);
  const [routeSegments, setRouteSegments] = useState([]);
  const [routeInfo, setRouteInfo] = useState(null);
  const [routeLoading, setRouteLoading] = useState(false);

  const mapRef = useRef(null);
  const pollTimer = useRef(null);
  const locationSub = useRef(null);
  const stopBleScan = useRef(null);
  const searchDebounce = useRef(null);

  // Load preferences
  useEffect(() => {
    // Load warn seconds from AsyncStorage (set by SettingsScreen slider)
    AsyncStorage.getItem('warn_seconds').then(val => {
      if (val) setWarnSeconds(parseInt(val));
    });

    if (!isGuest && userId) {
      client.get('/api/app/settings')
        .then(({ data }) => {
          if (data?.alert_radius_m) setAlertRadius(data.alert_radius_m);
          if (data) setPrefs({
            notify_ice:       data.notify_ice       ?? true,
            notify_bluetooth: data.notify_bluetooth ?? true,
            notify_route:     data.notify_route     ?? true,
          });
          AsyncStorage.setItem('user_preferences_cache', JSON.stringify(data));
        })
        .catch(() => {});
    }
  }, [userId, isGuest]);

  // Reload warn seconds when returning from Settings
  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      AsyncStorage.getItem('warn_seconds').then(val => {
        if (val) setWarnSeconds(parseInt(val));
      });
    });
    return unsubscribe;
  }, [navigation]);

  useEffect(() => {
    if (!location) return;
    if (allAlerts.length === 0) {
      setNearbyAlerts([]);
      setRouteAlerts([]);
      return;
    }

    const nearby = filterAlertsByRadius(
      allAlerts, location.latitude, location.longitude, alertRadius, 0
    );
    setNearbyAlerts(nearby);

    const onRoute = getRouteAlerts(
      location.latitude, location.longitude, speed, allAlerts, warnSeconds
    );
    setRouteAlerts(onRoute);

    if (prefs.notify_route && onRoute.length > 0) {
      Notifications.scheduleNotificationAsync({
        content: {
          title: 'Ice ahead on your route',
          body: onRoute[0].etaLabel === 'now'
            ? 'Entering an ice zone — slow down immediately.'
            : `Black ice ${onRoute[0].etaLabel} ahead on your current route. Slow down.`,
        },
        trigger: null,
      });
    }

    if (routeCoords) {
      const iceOnRoute = checkRouteForIce(routeCoords, allAlerts);
      setRouteIceAlerts(iceOnRoute);
      setRouteSegments(splitRouteSegments(routeCoords, iceOnRoute));
    }
  }, [allAlerts, location, heading, speed, alertRadius, prefs, routeCoords, warnSeconds]);

  // Poll backend every 5s using a ref for location to avoid restarting the interval
  const locationRef = useRef(null);
  useEffect(() => { locationRef.current = location; }, [location]);

  useEffect(() => {
    const interval = setInterval(async () => {
      if (!locationRef.current) return;
      const result = await fetchAlerts(locationRef.current.latitude, locationRef.current.longitude, 2000);
      console.log('[poll] alerts:', result.alerts.length, 'source:', result.source);
      setAllAlerts(result.alerts);
      setFetchSource(result.source);
      setCacheAge(result.cacheAge);
      setLastUpdated(new Date());
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    setupPermissions();
    return () => {
      if (pollTimer.current) clearInterval(pollTimer.current);
      if (locationSub.current) locationSub.current.remove();
      if (stopBleScan.current) stopBleScan.current();
      if (searchDebounce.current) clearTimeout(searchDebounce.current);
      resetHeadingHistory();
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

      Notifications.requestPermissionsAsync().then(async ({ status }) => {
        if (status === 'granted' && !isGuest) {
          try {
            const pushToken = await Notifications.getExpoPushTokenAsync({
              projectId: 'frostbyte-alert-app',
            }).catch(() => null);
            if (pushToken) {
              await client.post('/api/app/push-token', { push_token: pushToken.data })
                .catch(() => {});
            }
          } catch (e) {}
        }
      });

      let coords = null;
      try {
        const locPromise = Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 8000));
        const loc = await Promise.race([locPromise, timeout]);
        coords = loc.coords;
      } catch (e) {
        const last = await Location.getLastKnownPositionAsync();
        if (last) coords = last.coords;
      }

      setLocation(coords);
      setLoading(false);
      if (coords) doFetch(coords);

      locationSub.current = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 2000, distanceInterval: 5 },
        (loc) => {
          const c = loc.coords;
          setLocation(c);
          setHeading(c.heading);
          setSpeed(c.speed || 0);
          updateHeadingHistory(c.latitude, c.longitude, c.speed || 0, Date.now());
        }
      );

      pollTimer.current = setInterval(() => {
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
          .then(loc => doFetch(loc.coords))
          .catch(() => {});
      }, POLL_INTERVAL_MS);

      startBleScan();

      // Alerts are fetched by polling every 30s — no realtime subscription needed

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

  // ---------------------------------------------------------------------------
  // Search with debounced autocomplete
  // ---------------------------------------------------------------------------

  const handleSearchChange = (text) => {
    setDestQuery(text);
    if (searchDebounce.current) clearTimeout(searchDebounce.current);
    if (text.length < 3) { setSuggestions([]); return; }
    setSuggestionsLoading(true);
    searchDebounce.current = setTimeout(async () => {
      const results = await searchPlaces(text, location?.latitude, location?.longitude);
      setSuggestions(results);
      setSuggestionsLoading(false);
    }, 600);
  };

  const handleSelectSuggestion = async (place) => {
    Keyboard.dismiss();
    setDestQuery(place.shortName);
    setSuggestions([]);
    setSearchFocused(false);
    if (!location) { Alert.alert('No location', 'Waiting for GPS fix.'); return; }

    setRouteLoading(true);
    const route = await fetchRoute(location, { lat: place.lat, lon: place.lon });
    setRouteLoading(false);

    if (!route) {
      Alert.alert('Route error', 'Could not get directions. Check your ORS API key in routeNav.js.');
      return;
    }

    const iceOnRoute = checkRouteForIce(route.coordinates, allAlerts);
    setRouteCoords(route.coordinates);
    setRouteIceAlerts(iceOnRoute);
    setRouteSegments(splitRouteSegments(route.coordinates, iceOnRoute));
    setRouteInfo({ distanceKm: route.distanceKm, durationMin: route.durationMin });

    if (mapRef.current && route.coordinates.length > 1) {
      mapRef.current.fitToCoordinates(route.coordinates, {
        edgePadding: { top: 160, right: 40, bottom: 200, left: 40 },
        animated: true,
      });
    }

    if (iceOnRoute.length > 0) {
      Alert.alert(
        '⚠️ Ice on your route',
        `${iceOnRoute.length} ice alert${iceOnRoute.length > 1 ? 's' : ''} detected along your route.`
      );
    }
  };

  const clearRoute = () => {
    setRouteCoords(null);
    setRouteIceAlerts([]);
    setRouteSegments([]);
    setRouteInfo(null);
    setDestQuery('');
    setSuggestions([]);
  };

  // ---------------------------------------------------------------------------

  const getAlertColor = (confidence) => {
    if (confidence > 0.75) return '#ff3b30';
    if (confidence > 0.5)  return '#ff9500';
    return '#ffcc00';
  };

  const getSourceLabel = () => {
    switch (fetchSource) {
      case FetchSource.BACKEND:   return 'Local server';
      case FetchSource.SUPABASE:  return 'Live';
      case FetchSource.CACHE:     return `Cached ${cacheAge}min ago`;
      case FetchSource.NONE:      return 'Offline';
      default:                    return '';
    }
  };

  const getSourceColor = () => {
    switch (fetchSource) {
      case FetchSource.BACKEND:   return '#1a2a3d';

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

  const allMapAlerts = [
    ...(prefs.notify_ice ? nearbyAlerts : []),
    ...(prefs.notify_bluetooth ? bleAlerts.map(b => ({ ...b, id: `ble-${b.deviceId}` })) : []),
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
        <View style={styles.headerTop}>
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

        {/* Persistent search bar */}
        <View style={styles.searchBar}>
          <MaterialIcons name="search" size={18} color="#666" style={{ marginRight: 6 }} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search destination..."
            placeholderTextColor="#555"
            value={destQuery}
            onChangeText={handleSearchChange}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setTimeout(() => setSearchFocused(false), 200)}
            returnKeyType="search"
          />
          {routeLoading && <ActivityIndicator size="small" color="#4fc3f7" style={{ marginRight: 6 }} />}
          {destQuery.length > 0 && (
            <TouchableOpacity onPress={clearRoute} style={styles.searchClear}>
              <MaterialIcons name="close" size={16} color="#888" />
            </TouchableOpacity>
          )}
        </View>

        {/* Autocomplete suggestions */}
        {searchFocused && (suggestions.length > 0 || suggestionsLoading) && (
          <View style={styles.suggestions}>
            {suggestionsLoading && suggestions.length === 0 && (
              <View style={styles.suggestionItem}>
                <ActivityIndicator size="small" color="#4fc3f7" />
              </View>
            )}
            {suggestions.map((place, i) => (
              <TouchableOpacity
                key={i}
                style={[styles.suggestionItem, i < suggestions.length - 1 && styles.suggestionBorder]}
                onPress={() => handleSelectSuggestion(place)}
              >
                <MaterialIcons name="place" size={16} color="#4fc3f7" style={{ marginRight: 8 }} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.suggestionMain} numberOfLines={1}>{place.shortName}</Text>
                  <Text style={styles.suggestionSub} numberOfLines={1}>{place.displayName}</Text>
                </View>
                {place.distLabel && (
                  <Text style={styles.suggestionDist}>{place.distLabel}</Text>
                )}
              </TouchableOpacity>
            ))}
          </View>
        )}
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

        {visibleRouteAlerts.length > 0 && (
          <Text style={styles.routeWarning}>
            Ice on your route — {visibleRouteAlerts[0].etaLabel === 'now'
              ? 'entering ice zone now'
              : `${visibleRouteAlerts[0].etaLabel} ahead`}
          </Text>
        )}

        {routeInfo && (
          <View style={styles.routeInfoRow}>
            <Text style={styles.routeInfoText}>
              📍 {routeInfo.distanceKm}km · {routeInfo.durationMin}min
              {routeIceAlerts.length > 0
                ? `  ·  ⚠️ ${routeIceAlerts.length} ice zone${routeIceAlerts.length > 1 ? 's' : ''}`
                : '  ·  ✅ Clear'}
            </Text>
            <TouchableOpacity onPress={clearRoute}>
              <Text style={styles.clearRoute}>✕</Text>
            </TouchableOpacity>
          </View>
        )}

        {lastUpdated && (
          <Text style={styles.bannerSub}>Updated {lastUpdated.toLocaleTimeString()}</Text>
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

        {routeSegments.map((seg, i) => (
          <Polyline
            key={`nav-${i}`}
            coordinates={seg.points}
            strokeColor={seg.isDanger ? '#ff3b30' : '#4fc3f7'}
            strokeWidth={seg.isDanger ? 5 : 3}
          />
        ))}

        {routeCoords && routeCoords.length > 0 && (
          <Marker
            coordinate={routeCoords[routeCoords.length - 1]}
            title="Destination"
            pinColor="#4fc3f7"
          />
        )}
      </MapView>

      <TouchableOpacity style={styles.iconButton} onPress={centerOnUser}>
        <MaterialIcons name="my-location" size={22} color="#fff" />
      </TouchableOpacity>

      <TouchableOpacity style={[styles.iconButton, styles.refreshIconButton]} onPress={async () => {
        if (!locationRef.current) return;
        const result = await fetchAlerts(locationRef.current.latitude, locationRef.current.longitude, 2000);
        console.log('[manual refresh] alerts:', result.alerts.length);
        setAllAlerts(result.alerts);
        setFetchSource(result.source);
        setCacheAge(result.cacheAge);
        setLastUpdated(new Date());
      }}>
        <MaterialIcons name="refresh" size={22} color="#fff" />
      </TouchableOpacity>

      <TouchableOpacity style={[styles.iconButton, styles.bleIconButton]} onPress={startBleScan}>
        <MaterialIcons name="bluetooth-searching" size={22} color="#4fc3f7" />
      </TouchableOpacity>

      <View style={styles.legend}>
        <Text style={styles.legendTitle}>Risk Level</Text>
        <View style={styles.legendRow}>
          <View style={[styles.legendDot, { backgroundColor: '#ff3b30' }]} />
          <Text style={styles.legendText}>High over 75%</Text>
        </View>
        <View style={styles.legendRow}>
          <View style={[styles.legendDot, { backgroundColor: '#ff9500' }]} />
          <Text style={styles.legendText}>Medium 50–75%</Text>
        </View>
        <View style={styles.legendRow}>
          <View style={[styles.legendDot, { backgroundColor: '#ffcc00' }]} />
          <Text style={styles.legendText}>Low under 50%</Text>
        </View>
        <View style={styles.legendRow}>
          <View style={[styles.legendDot, { backgroundColor: '#4fc3f7' }]} />
          <Text style={styles.legendText}>Bluetooth</Text>
        </View>
        {routeCoords && (
          <>
            <View style={styles.legendRow}>
              <View style={[styles.legendDot, { backgroundColor: '#4fc3f7', borderRadius: 0 }]} />
              <Text style={styles.legendText}>Route (clear)</Text>
            </View>
            <View style={styles.legendRow}>
              <View style={[styles.legendDot, { backgroundColor: '#ff3b30', borderRadius: 0 }]} />
              <Text style={styles.legendText}>Route (ice)</Text>
            </View>
          </>
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
    backgroundColor: '#1a1a2e',
    paddingTop: Platform.OS === 'ios' ? 52 : 40,
    paddingBottom: 8,
    zIndex: 100,
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 10,
  },
  headerTitle: { color: '#fff', fontSize: 20, fontWeight: 'bold' },
  guestBadge: { color: '#4fc3f7', fontSize: 10, fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: 1 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  headerBtn: { paddingHorizontal: 8, paddingVertical: 4 },
  headerBtnText: { color: '#4fc3f7', fontSize: 14 },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0f1b2d',
    marginHorizontal: 16,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#0f3460',
  },
  searchInput: {
    flex: 1,
    color: '#fff',
    fontSize: 14,
    paddingVertical: 0,
  },
  searchClear: { padding: 4 },
  suggestions: {
    marginHorizontal: 16,
    marginTop: 4,
    backgroundColor: '#0f1b2d',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#0f3460',
    overflow: 'hidden',
    zIndex: 200,
  },
  suggestionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  suggestionBorder: {
    borderBottomWidth: 1,
    borderBottomColor: '#1a2a3d',
  },
  suggestionMain: { color: '#fff', fontSize: 13, fontWeight: '500' },
  suggestionSub: { color: '#666', fontSize: 11, marginTop: 1 },
  suggestionDist: { color: '#4fc3f7', fontSize: 11, marginLeft: 8, flexShrink: 0 },
  banner: { paddingVertical: 10, paddingHorizontal: 16 },
  bannerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  bannerText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  sourceLabel: { color: '#aaa', fontSize: 11 },
  routeWarning: { color: '#ff3b30', fontSize: 13, fontWeight: 'bold', marginTop: 4 },
  routeInfoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 },
  routeInfoText: { color: '#ccc', fontSize: 11, flex: 1 },
  clearRoute: { color: '#aaa', fontSize: 14, paddingLeft: 8 },
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
  refreshIconButton: {
    bottom: 140,
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