/**
 * routeAlert.js
 * Client-side computation for route-based and proximity-based ice alerting.
 * All computation runs on the phone — no backend involvement.
 */

const EARTH_RADIUS_M = 6371000;

// Rolling window of GPS positions for smoothed heading computation
let headingHistory = [];
const MAX_HISTORY = 6;

function toRad(deg) {
  return deg * (Math.PI / 180);
}

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
 * Add a GPS sample to the heading history.
 * Called every 2 seconds from HomeScreen's location watcher.
 */
export function updateHeadingHistory(lat, lon, speed, timestamp) {
  headingHistory.push({ lat, lon, speed, timestamp });
  if (headingHistory.length > MAX_HISTORY) {
    headingHistory.shift();
  }
}

export function resetHeadingHistory() {
  headingHistory = [];
}

/**
 * Compute a smoothed heading from the history using circular mean of bearing vectors.
 * Returns heading in degrees [0, 360) or null if insufficient data.
 */
function getSmoothedHeading() {
  if (headingHistory.length < 2) return null;

  let sinSum = 0;
  let cosSum = 0;
  let count = 0;

  for (let i = 1; i < headingHistory.length; i++) {
    const prev = headingHistory[i - 1];
    const curr = headingHistory[i];
    const dist = distanceMeters(prev.lat, prev.lon, curr.lat, curr.lon);
    if (dist < 2) continue; // ignore stationary noise

    const dLon = toRad(curr.lon - prev.lon);
    const lat1 = toRad(prev.lat);
    const lat2 = toRad(curr.lat);
    const y = Math.sin(dLon) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
    const bearing = Math.atan2(y, x);
    sinSum += Math.sin(bearing);
    cosSum += Math.cos(bearing);
    count++;
  }

  if (count === 0) return null;
  const avgBearing = Math.atan2(sinSum / count, cosSum / count);
  return ((avgBearing * 180 / Math.PI) + 360) % 360;
}

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
 *
 * @param {number} userLat
 * @param {number} userLon
 * @param {number} speedMs
 * @param {Array} alerts
 * @param {number} warnThresholdSeconds - only return alerts within this many seconds (from user setting)
 * @param {number} alertZoneRadiusM
 * @param {number} lookAheadSeconds
 */
export function getRouteAlerts(
  userLat,
  userLon,
  speedMs,
  alerts,
  warnThresholdSeconds = 10,
  alertZoneRadiusM = 100,
  lookAheadSeconds = 60
) {
  if (speedMs < 0.5) return [];

  const headingDeg = getSmoothedHeading();
  if (headingDeg == null) return [];

  const projectedPath = projectPath(userLat, userLon, headingDeg, speedMs, lookAheadSeconds);
  const routeAlerts = [];

  for (const alert of alerts) {
    for (const point of projectedPath) {
      const dist = distanceMeters(point.lat, point.lon, alert.latitude, alert.longitude);
      if (dist <= alertZoneRadiusM) {
        // Only include if within the user's chosen warn threshold
        if (point.secondsAhead <= warnThresholdSeconds) {
          const etaLabel = point.secondsAhead <= 3
            ? 'now'
            : point.secondsAhead < 60
              ? `${point.secondsAhead}s`
              : `${Math.round(point.secondsAhead / 60)}min`;
          routeAlerts.push({
            ...alert,
            secondsUntilReach: point.secondsAhead,
            etaLabel,
            routeDistanceM: dist,
          });
        }
        break;
      }
    }
  }

  return routeAlerts.sort((a, b) => a.secondsUntilReach - b.secondsUntilReach);
}