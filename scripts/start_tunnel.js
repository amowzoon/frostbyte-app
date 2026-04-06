/**
 * scripts/start_tunnel.js
 * Starts a Cloudflare Quick Tunnel and automatically updates client.js
 * with the new public URL.
 *
 * Usage (from frostbyte-app folder):
 *   node scripts/start_tunnel.js
 *
 * Requirements:
 *   - cloudflared must be installed (winget install Cloudflare.cloudflared)
 *   - Docker backend must already be running (docker compose up)
 *
 * What it does:
 *   1. Starts cloudflared tunnel pointing at localhost:8000
 *   2. Watches the output for the public URL
 *   3. Automatically updates api/client.js with the new URL
 *   4. Keeps the tunnel running until you press Ctrl+C
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const CLIENT_JS_PATH = path.join(__dirname, '..', 'api', 'client.js');
const URL_REGEX = /https:\/\/[a-z0-9\-]+\.trycloudflare\.com/;

let urlUpdated = false;

function updateClientJs(tunnelUrl) {
  try {
    let content = fs.readFileSync(CLIENT_JS_PATH, 'utf8');

    // Replace any existing BASE_URL value
    content = content.replace(
      /export const BASE_URL = '.*?';/,
      `export const BASE_URL = '${tunnelUrl}';`
    );

    fs.writeFileSync(CLIENT_JS_PATH, content, 'utf8');
    console.log(`\nclient.js updated with: ${tunnelUrl}`);
    console.log('   The app will hot reload automatically.\n');
  } catch (e) {
    console.error('Failed to update client.js:', e.message);
  }
}

function startTunnel() {
  console.log('Starting Cloudflare Quick Tunnel → localhost:8000');
  console.log('   Waiting for public URL...\n');

  const tunnel = spawn('cloudflared', ['tunnel', '--url', 'http://localhost:8000'], {
    stdio: ['inherit', 'pipe', 'pipe'],
  });

  // Cloudflare prints the URL to stderr
  tunnel.stderr.on('data', (data) => {
    const output = data.toString();

    // Print cloudflared output so user can see what's happening
    process.stderr.write(output);

    // Extract and apply the tunnel URL as soon as it appears
    if (!urlUpdated) {
      const match = output.match(URL_REGEX);
      if (match) {
        const tunnelUrl = match[0];
        urlUpdated = true;
        updateClientJs(tunnelUrl);
        console.log('Tunnel is live. Your backend is reachable from any network.');
        console.log('   Press Ctrl+C to stop.\n');
      }
    }
  });

  tunnel.stdout.on('data', (data) => {
    const output = data.toString();
    process.stdout.write(output);

    if (!urlUpdated) {
      const match = output.match(URL_REGEX);
      if (match) {
        const tunnelUrl = match[0];
        urlUpdated = true;
        updateClientJs(tunnelUrl);
      }
    }
  });

  tunnel.on('close', (code) => {
    if (code !== 0 && code !== null) {
      console.error(`\nCloudflare tunnel exited with code ${code}`);
      console.error('   Make sure cloudflared is installed: winget install Cloudflare.cloudflared');
    } else {
      console.log('\nTunnel stopped.');
    }
  });

  tunnel.on('error', (err) => {
    if (err.code === 'ENOENT') {
      console.error('cloudflared not found.');
      console.error('   Install it with: winget install Cloudflare.cloudflared');
    } else {
      console.error('Failed to start tunnel:', err.message);
    }
    process.exit(1);
  });

  // Keep tunnel alive, restore BASE_URL on exit
  process.on('SIGINT', () => {
    console.log('\n\nStopping tunnel...');
    tunnel.kill();
    process.exit(0);
  });
}

startTunnel();