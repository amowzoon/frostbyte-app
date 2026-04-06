import axios from 'axios';
import { supabase } from '../lib/supabase';

// Backend URL points to hosted backend.
// Alerts are served from Supabase directly (Layer 1 in networkManager.js)
// so the app works fully without needing the backend reachable.
export const BASE_URL = 'http://150.136.139.169:8000';

const client = axios.create({
  baseURL: BASE_URL,
  timeout: 10000,
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