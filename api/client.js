import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Change this to your backend URL.
// While developing, use your computer's local IP address (not localhost).
// Find it by running `ipconfig` on Windows — look for IPv4 Address.
// Example: http://192.168.1.45:8000
export const BASE_URL = 'http://10.0.0.18:8000';

const client = axios.create({
  baseURL: BASE_URL,
  timeout: 10000,
});

// Automatically attach JWT token to every request
client.interceptors.request.use(async (config) => {
  const token = await AsyncStorage.getItem('auth_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export default client;