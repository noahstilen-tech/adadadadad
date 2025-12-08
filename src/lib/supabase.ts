import { createClient } from '@supabase/supabase-js';
import { config } from './config';

if (!config.isConfigured) {
  console.error('Missing Supabase environment variables');
}

export const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey);

export interface TwitterConfig {
  id: string;
  client_id: string;
  client_secret: string;
  redirect_uri: string;
  created_at: string;
  updated_at: string;
}

export interface AuthorizedUser {
  id: string;
  username: string;
  access_token: string;
  refresh_token: string | null;
  created_at: string;
}
