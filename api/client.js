import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';

// Set via BACKEND_URL env var at eas update time.
// Default: local network IP for testing against local Docker stack.
// Linux machine (tunnel): BACKEND_URL=http://localhost:8080 eas update
// Linux machine (same LAN): BACKEND_URL=http://<linux-ip>:<port> eas update
export const BASE_URL = Constants.expoConfig.extra.backendUrl;

const client = axios.create({
  baseURL: BASE_URL,
  timeout: 10000,
});

// Attach JWT from AsyncStorage to every request
client.interceptors.request.use(async (config) => {
  const token = await AsyncStorage.getItem('auth_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

client.interceptors.response.use(
  response => response,
  error => {
    console.warn('API error:', error.response?.status, error.response?.data, error.config?.url);
    return Promise.reject(error);
  }
);

export default client;