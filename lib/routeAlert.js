/**
 * routeAlert.js
 * Client-side computation for route-based and proximity-based ice alerting.
 * All computation runs on the phone — no backend involvement.
 */

const EARTH_RADIUS_M = 6371000;

function toRad(deg) {
  return deg * (Math.PI / 180);
}

/**
 * Haversine distance between two GPS coordinates in meters.
 * More accurate than the bounding box approximation used by the backend.
 */
export function distanceMeters(lat1, lon1, lat2, lon2) {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_M * c;
}

/**
 * Filter alerts by exact radius using Haversine distance.
 * The backend uses a bounding box approximation — this is the precise version.
 *
 * @param {Array} alerts - alert objects with latitude, longitude, confidence
 * @param {number} userLat - user's current latitude
 * @param {number} userLon - user's current longitude
 * @param {number} radiusM - alert radius in meters from user preferences
 * @param {number} minConfidence - minimum confidence threshold 0 to 1
 * @returns {Array} filtered alerts sorted by distance ascending
 */
export function filterAlertsByRadius(alerts, userLat, userLon, radiusM, minConfidence = 0) {
  return alerts
    .map(alert => ({
      ...alert,
      distanceM: distanceMeters(userLat, userLon, alert.latitude, alert.longitude),
    }))
    .filter(alert =>
      alert.distanceM <= radiusM &&
      alert.confidence >= minConfidence
    )
    .sort((a, b) => a.distanceM - b.distanceM);
}

/**
 * Project the user's position forward in time based on heading and speed.
 * Returns positions at 5-second intervals up to lookAheadSeconds.
 */
function projectPath(lat, lon, headingDeg, speedMs, lookAheadSeconds = 60) {
  const positions = [];
  const headingRad = toRad(headingDeg);

  for (let t = 5; t <= lookAheadSeconds; t += 5) {
    const distanceM = speedMs * t;
    const dLat = (distanceM * Math.cos(headingRad)) / EARTH_RADIUS_M;
    const dLon = (distanceM * Math.sin(headingRad)) /
      (EARTH_RADIUS_M * Math.cos(toRad(lat)));

    positions.push({
      lat: lat + (dLat * 180) / Math.PI,
      lon: lon + (dLon * 180) / Math.PI,
      secondsAhead: t,
    });
  }

  return positions;
}

/**
 * Check if the user's projected route passes through any alert zones.
 * Each alert zone is a circle of alertZoneRadiusM around the alert coordinate.
 *
 * @param {number} userLat - current latitude
 * @param {number} userLon - current longitude
 * @param {number} headingDeg - direction of travel in degrees, 0 = north, 90 = east
 * @param {number} speedMs - speed in meters per second
 * @param {Array} alerts - array of alert objects
 * @param {number} alertZoneRadiusM - radius of each alert zone in meters
 * @param {number} lookAheadSeconds - how far ahead to project
 * @returns {Array} alerts the route intersects, with secondsUntilReach added
 */
export function getRouteAlerts(
  userLat,
  userLon,
  headingDeg,
  speedMs,
  alerts,
  alertZoneRadiusM = 100,
  lookAheadSeconds = 60
) {
  // Need at least 0.5 m/s (slow walking pace) for a meaningful projection
  if (speedMs < 0.5 || headingDeg == null) {
    return [];
  }

  const projectedPath = projectPath(userLat, userLon, headingDeg, speedMs, lookAheadSeconds);
  const routeAlerts = [];

  for (const alert of alerts) {
    for (const point of projectedPath) {
      const dist = distanceMeters(point.lat, point.lon, alert.latitude, alert.longitude);
      if (dist <= alertZoneRadiusM) {
        routeAlerts.push({
          ...alert,
          secondsUntilReach: point.secondsAhead,
          routeDistanceM: dist,
        });
        break; // add each alert once
      }
    }
  }

  return routeAlerts.sort((a, b) => a.secondsUntilReach - b.secondsUntilReach);
}