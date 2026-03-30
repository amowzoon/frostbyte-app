import axios from 'axios';
import { supabase } from '../lib/supabase';

// Public backend URL via ngrok tunnel.
// Update this whenever ngrok restarts (free plan gives a new URL each time).
export const BASE_URL = 'https://superprosperous-arnulfo-pebbly.ngrok-free.dev';

const client = axios.create({
  baseURL: BASE_URL,
  timeout: 10000,
  headers: {
    // Required to bypass ngrok's browser warning page
    'ngrok-skip-browser-warning': 'true',
  },
});

// Automatically attach the Supabase JWT to every backend request
client.interceptors.request.use(async (config) => {
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.access_token) {
    config.headers.Authorization = `Bearer ${session.access_token}`;
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
