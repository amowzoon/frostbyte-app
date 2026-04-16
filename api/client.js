import axios from 'axios';
import Constants from 'expo-constants';
import { getSecure, TOKEN_KEY } from '../lib/secureStorage';

// Set via BACKEND_URL env var at eas update time.
// Local dev: BACKEND_URL=http://10.0.0.18:8001 eas update --branch main
// Production: BACKEND_URL=https://superprosperous-arnulfo-pebbly.ngrok-free.dev eas update --branch main
export const BASE_URL = Constants.expoConfig.extra.backendUrl;

const client = axios.create({
  baseURL: BASE_URL,
  timeout: 10000,
});

// Attach JWT from SecureStore to every request
client.interceptors.request.use(async (config) => {
  const token = await getSecure(TOKEN_KEY);
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