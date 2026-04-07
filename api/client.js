import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Tunnel to Linux machine for dev.
// On same local network as Pi, swap to: http://10.0.0.176:8000
//export const BASE_URL = 'http://localhost:8080'; // use this line
export const BASE_URL = 'http://localhost:8000'; // testing, comment out

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