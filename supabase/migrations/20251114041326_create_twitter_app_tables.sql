/*
  # Twitter OAuth App Schema

  1. New Tables
    - `twitter_config`
      - `id` (uuid, primary key) - Configuration ID
      - `client_id` (text) - Twitter OAuth Client ID
      - `client_secret` (text) - Twitter OAuth Client Secret
      - `redirect_uri` (text) - Twitter OAuth Redirect URI
      - `created_at` (timestamptz) - When configuration was created
      - `updated_at` (timestamptz) - When configuration was last updated
    
    - `authorized_users`
      - `id` (text, primary key) - Twitter user ID
      - `username` (text) - Twitter username
      - `access_token` (text) - OAuth access token
      - `refresh_token` (text) - OAuth refresh token
      - `created_at` (timestamptz) - When user was authorized

  2. Security
    - Enable RLS on both tables
    - For simplicity, allow public access since this is a test/demo app
    - In production, you would restrict these to authenticated admin users

  3. Important Notes
    - Only one config row will be used (singleton pattern)
    - User IDs from Twitter are stored as text (Twitter uses string IDs)
    - Tokens are sensitive and should be encrypted in production
*/

CREATE TABLE IF NOT EXISTS twitter_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id text NOT NULL DEFAULT '',
  client_secret text NOT NULL DEFAULT '',
  redirect_uri text NOT NULL DEFAULT '',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS authorized_users (
  id text PRIMARY KEY,
  username text NOT NULL,
  access_token text NOT NULL,
  refresh_token text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE twitter_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE authorized_users ENABLE ROW LEVEL SECURITY;

-- Allow public access for demo purposes (restrict in production)
CREATE POLICY "Allow public read on twitter_config"
  ON twitter_config FOR SELECT
  TO public
  USING (true);

CREATE POLICY "Allow public insert on twitter_config"
  ON twitter_config FOR INSERT
  TO public
  WITH CHECK (true);

CREATE POLICY "Allow public update on twitter_config"
  ON twitter_config FOR UPDATE
  TO public
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow public read on authorized_users"
  ON authorized_users FOR SELECT
  TO public
  USING (true);

CREATE POLICY "Allow public insert on authorized_users"
  ON authorized_users FOR INSERT
  TO public
  WITH CHECK (true);

CREATE POLICY "Allow public delete on authorized_users"
  ON authorized_users FOR DELETE
  TO public
  USING (true);

-- Insert a default config row to use as singleton
INSERT INTO twitter_config (client_id, client_secret, redirect_uri)
VALUES ('', '', '')
ON CONFLICT DO NOTHING;