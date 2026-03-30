/**
 * bleManager.js
 * Bluetooth Low Energy scanning for nearby FrostByte devices.
 * Runs as a background layer alongside the network fallback system.
 *
 * The Pi broadcasts a BLE advertisement with a FrostByte service UUID.
 * The app scans for this UUID and reads the ice detection status characteristic.
 *
 * Requires: npx expo install react-native-ble-plx
 * Note: BLE requires a development build (not Expo Go) for production use.
 * For demo purposes, the BLE layer gracefully does nothing if unavailable.
 */

// FrostByte BLE identifiers — must match what the Pi broadcasts
export const FROSTBYTE_SERVICE_UUID = '12345678-1234-1234-1234-123456789abc';
export const STATUS_CHARACTERISTIC_UUID = '12345678-1234-1234-1234-123456789abd';

let BleManager = null;
let bleAvailable = false;

// Attempt to load BLE library — fails gracefully if not installed
try {
  const { BleManager: Manager } = require('react-native-ble-plx');
  BleManager = new Manager();
  bleAvailable = true;
} catch (e) {
  console.warn('BLE not available — install react-native-ble-plx for Bluetooth support:', e.message);
}

/**
 * Scan for nearby FrostByte Pi devices over Bluetooth.
 * Calls onDeviceFound for each detected device with ice detection data.
 * Automatically stops scanning after timeoutMs.
 *
 * @param {function} onDeviceFound - called with { deviceId, confidence, latitude, longitude }
 * @param {number} timeoutMs - how long to scan in milliseconds (default 10 seconds)
 * @returns {function} stopScan — call this to stop scanning early
 */
export function scanForFrostByteDevices(onDeviceFound, timeoutMs = 10000) {
  if (!bleAvailable || !BleManager) {
    console.warn('BLE not available, skipping scan');
    return () => {};
  }

  const discovered = new Set();

  BleManager.startDeviceScan(
    [FROSTBYTE_SERVICE_UUID],  // only scan for FrostByte service UUID
    { allowDuplicates: false },
    async (error, device) => {
      if (error) {
        console.warn('BLE scan error:', error.message);
        return;
      }

      if (!device || discovered.has(device.id)) return;
      discovered.add(device.id);

      try {
        // Connect and read the status characteristic
        const connected = await device.connect();
        await connected.discoverAllServicesAndCharacteristics();

        const characteristic = await connected.readCharacteristicForService(
          FROSTBYTE_SERVICE_UUID,
          STATUS_CHARACTERISTIC_UUID
        );

        // Characteristic value is base64 encoded JSON
        const raw = Buffer.from(characteristic.value, 'base64').toString('utf-8');
        const status = JSON.parse(raw);

        // Disconnect after reading — we don't need a persistent connection
        await connected.cancelConnection();

        if (status.confidence > 0) {
          onDeviceFound({
            deviceId: device.id,
            deviceName: device.name || 'FrostByte Device',
            confidence: status.confidence,
            latitude: status.latitude,
            longitude: status.longitude,
            rssi: device.rssi, // signal strength — stronger = closer
            source: 'bluetooth',
          });
        }
      } catch (e) {
        console.warn(`Failed to read from BLE device ${device.id}:`, e.message);
      }
    }
  );

  // Auto-stop after timeout
  const timer = setTimeout(() => {
    BleManager.stopDeviceScan();
  }, timeoutMs);

  // Return stop function for manual early termination
  return () => {
    clearTimeout(timer);
    BleManager.stopDeviceScan();
  };
}

/**
 * Check if BLE is available and powered on.
 * Returns 'PoweredOn', 'PoweredOff', 'Unauthorized', or 'Unavailable'.
 */
export async function getBleState() {
  if (!bleAvailable || !BleManager) return 'Unavailable';
  return new Promise(resolve => {
    BleManager.onStateChange(state => resolve(state), true);
  });
}