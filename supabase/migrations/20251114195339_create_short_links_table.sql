/*
  # Create short links table

  1. New Tables
    - `short_links`
      - `id` (uuid, primary key)
      - `short_code` (text, unique) - The shortened code for the URL
      - `target_url` (text) - The full URL to redirect to
      - `created_at` (timestamptz)
      - `click_count` (integer) - Track how many times the link was clicked

  2. Security
    - Enable RLS on `short_links` table
    - Add policy for anyone to read short links (they're meant to be public)
    - Only service role can create/update short links
*/

CREATE TABLE IF NOT EXISTS short_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  short_code text UNIQUE NOT NULL,
  target_url text NOT NULL,
  click_count integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE short_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read short links"
  ON short_links
  FOR SELECT
  USING (true);

CREATE POLICY "Service role can insert short links"
  ON short_links
  FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Service role can update short links"
  ON short_links
  FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);