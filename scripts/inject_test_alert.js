/**
 * scripts/inject_test_alert.js
 * Injects a test alert into Supabase so it appears on the app map.
 *
 * Usage:
 *   node scripts/inject_test_alert.js <----- try this first
 *   node scripts/inject_test_alert.js --lat 42.3505 --lon -71.1054 --confidence 0.82
 *   node scripts/inject_test_alert.js --expire 10        (expire in 10 minutes)
 *   node scripts/inject_test_alert.js --clean            (remove all test alerts)
 *   node scripts/inject_test_alert.js --list             (show active test alerts)
 *
 * The alert appears in the app within 30 seconds (next poll cycle).
 * Alerts are marked is_test=FALSE so they show to real users — use --clean to remove.
 *
 * Setup (one time):
 *   1. Copy scripts/.env.example to scripts/.env
 *   2. Fill in your Supabase URL and service role key
 */

const https = require('https');
const http  = require('http');
const path  = require('path');
const fs    = require('fs');

// ---------------------------------------------------------------------------
// Load config from scripts/.env or environment variables
// ---------------------------------------------------------------------------

const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const [key, ...val] = line.split('=');
    if (key && val.length) process.env[key.trim()] = val.join('=').trim();
  });
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY; // service role key

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('\nMissing Supabase credentials.');
  console.error('Create scripts/.env with:');
  console.error('  SUPABASE_URL=https://your-project.supabase.co');
  console.error('  SUPABASE_SERVICE_KEY=your-service-role-key\n');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Parse CLI args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const get  = (flag, def) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : def;
};
const has = flag => args.includes(flag);

const lat        = parseFloat(get('--lat',        '42.3505'));
const lon        = parseFloat(get('--lon',        '-71.1054'));
const confidence = parseFloat(get('--confidence', '0.82'));
const expireMin  = parseInt(get('--expire',       '120'));
const alertType  = get('--type', 'ice');
const clean      = has('--clean');
const list       = has('--list');

// ---------------------------------------------------------------------------
// HTTP helper for Supabase REST API
// ---------------------------------------------------------------------------

function supabaseRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const url     = new URL(SUPABASE_URL);
    const options = {
      hostname: url.hostname,
      port:     url.port || 443,
      path:     `/rest/v1/${path}`,
      method,
      headers: {
        'apikey':        SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type':  'application/json',
        'Prefer':        'return=representation',
      },
    };

    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: data ? JSON.parse(data) : null });
        } catch {
          resolve({ status: res.statusCode, data });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function listAlerts() {
  const res = await supabaseRequest(
    'GET',
    'ice_alerts?select=id,latitude,longitude,confidence,alert_type,created_at,expires_at&active=eq.true&order=created_at.desc&limit=20'
  );
  const alerts = res.data || [];
  if (alerts.length === 0) {
    console.log('\n  No active alerts in Supabase.\n');
    return;
  }
  console.log(`\n  Active alerts in Supabase (${alerts.length}):`);
  alerts.forEach(a => {
    const exp = new Date(a.expires_at);
    const minsLeft = Math.round((exp - Date.now()) / 60000);
    console.log(`  - ${a.id.slice(0, 8)}...  conf=${Math.round(a.confidence*100)}%  type=${a.alert_type}  lat=${a.latitude}  lon=${a.longitude}  expires in ${minsLeft}min`);
  });
  console.log();
}

async function cleanAlerts() {
  // Deactivate all active non-test alerts at BU coordinates
  const res = await supabaseRequest(
    'PATCH',
    'ice_alerts?active=eq.true',
    { active: false }
  );
  console.log(`\n  Deactivated all active alerts in Supabase.`);
  console.log(`  They will disappear from the app within 30 seconds.\n`);
}

async function injectAlert() {
  const expiresAt = new Date(Date.now() + expireMin * 60 * 1000).toISOString();

  const payload = {
    latitude:   lat,
    longitude:  lon,
    confidence,
    alert_type: alertType,
    is_test:    false,
    active:     true,
    expires_at: expiresAt,
  };

  console.log(`\n  Injecting test alert into Supabase:`);
  console.log(`  Location:   ${lat}, ${lon}`);
  console.log(`  Confidence: ${Math.round(confidence * 100)}%`);
  console.log(`  Type:       ${alertType}`);
  console.log(`  Expires in: ${expireMin} minutes`);

  const res = await supabaseRequest('POST', 'ice_alerts', payload);

  if (res.status === 200 || res.status === 201) {
    const alert = Array.isArray(res.data) ? res.data[0] : res.data;
    console.log(`\n  Alert inserted successfully.`);
    console.log(`  ID: ${alert?.id}`);
    console.log(`\n  The alert will appear on the app map within 30 seconds.`);
    console.log(`  To remove it: node scripts/inject_test_alert.js --clean\n`);
  } else {
    console.error(`\n  Failed to insert alert. Status: ${res.status}`);
    console.error(`  Response: ${JSON.stringify(res.data)}\n`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

(async () => {
  try {
    if (list)       await listAlerts();
    else if (clean) await cleanAlerts();
    else            await injectAlert();
  } catch (err) {
    console.error('\n  Error:', err.message, '\n');
    process.exit(1);
  }
})();
