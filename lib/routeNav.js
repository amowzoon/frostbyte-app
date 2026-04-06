/**
 * routeNav.js
 * Place search via Nominatim (OpenStreetMap).
 * Routing via OpenRouteService.
 */

const ORS_API_KEY = 'eyJvcmciOiI1YjNjZTM1OTc4NTExMTAwMDFjZjYyNDgiLCJpZCI6ImM1NzgyYjRlYjY4ZDQzYzBhOWEyZTU5ZjFmYTAzMGNjIiwiaCI6Im11cm11cjY0In0=';
const ORS_URL = 'https://api.openrouteservice.org/v2/directions/driving-car/geojson';
const DANGER_RADIUS_M = 100;

function toRad(deg) { return deg * Math.PI / 180; }

function distanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function normalize(str) {
  return str
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/@/g, 'at')
    .replace(/[+]/g, 'and')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function searchPlaces(query, userLat, userLon) {
  if (!query || query.length < 3) return [];
  const q = normalize(query);
  try {
    const params = new URLSearchParams({
      q,
      format: 'json',
      limit: '50',
      addressdetails: '1',
    });
    if (userLat && userLon) {
      params.append('viewbox', `${userLon - 0.5},${userLat + 0.35},${userLon + 0.5},${userLat - 0.35}`);
      params.append('bounded', '0');
    }
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?${params}`,
      { headers: { 'User-Agent': 'FrostByteApp/1.0', 'Accept-Language': 'en' } }
    );
    const data = await res.json();
    if (!data?.length) return [];

    return data
      .map(item => {
        const lat = parseFloat(item.lat);
        const lon = parseFloat(item.lon);
        const distM = (userLat && userLon) ? distanceMeters(lat, lon, userLat, userLon) : 999999;
        const name = item.name || item.display_name.split(',')[0];
        const addr = item.display_name.split(',').slice(1, 3).join(',').trim();
        const distLabel = distM < 1000 ? `${Math.round(distM)}m` : `${(distM / 1000).toFixed(1)}km`;
        return { displayName: item.display_name, shortName: addr ? `${name}, ${addr}` : name, distLabel, lat, lon, _distM: distM };
      })
      .filter(p => p._distM < 50000)
      .sort((a, b) => a._distM - b._distM)
      .slice(0, 5)
      .map(({ _distM, ...item }) => item);
  } catch (e) {
    console.warn('Place search failed:', e.message);
    return [];
  }
}

export async function fetchRoute(origin, destination) {
  try {
    const res = await fetch(ORS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': ORS_API_KEY },
      body: JSON.stringify({
        coordinates: [
          [origin.longitude, origin.latitude],
          [destination.lon, destination.lat],
        ],
      }),
    });
    if (!res.ok) throw new Error(`ORS ${res.status}`);
    const data = await res.json();
    const feature = data?.features?.[0];
    if (!feature) return null;
    const coordinates = feature.geometry.coordinates.map(([lon, lat]) => ({ latitude: lat, longitude: lon }));
    const summary = feature.properties?.summary || {};
    return {
      coordinates,
      distanceKm: summary.distance ? (summary.distance / 1000).toFixed(1) : null,
      durationMin: summary.duration ? Math.round(summary.duration / 60) : null,
    };
  } catch (e) {
    console.warn('Route fetch failed:', e.message);
    return null;
  }
}

export function checkRouteForIce(routeCoordinates, alerts) {
  if (!routeCoordinates?.length || !alerts?.length) return [];
  return alerts.filter(alert =>
    routeCoordinates.some(pt =>
      distanceMeters(pt.latitude, pt.longitude, alert.latitude, alert.longitude) <= DANGER_RADIUS_M
    )
  );
}

export function splitRouteSegments(routeCoordinates, dangerAlerts) {
  if (!routeCoordinates || routeCoordinates.length < 2) return [];
  const isDangerPt = (pt) =>
    dangerAlerts.some(a =>
      distanceMeters(pt.latitude, pt.longitude, a.latitude, a.longitude) <= DANGER_RADIUS_M
    );
  const segments = [];
  let curDanger = isDangerPt(routeCoordinates[0]);
  let curPoints = [routeCoordinates[0]];
  for (let i = 1; i < routeCoordinates.length; i++) {
    const pt = routeCoordinates[i];
    const danger = isDangerPt(pt);
    if (danger !== curDanger) {
      if (curPoints.length >= 2) segments.push({ points: curPoints, isDanger: curDanger });
      curDanger = danger;
      curPoints = [routeCoordinates[i - 1], pt];
    } else {
      curPoints.push(pt);
    }
  }
  if (curPoints.length >= 2) segments.push({ points: curPoints, isDanger: curDanger });
  return segments;
}