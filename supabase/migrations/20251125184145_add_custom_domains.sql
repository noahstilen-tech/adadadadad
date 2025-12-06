/*
  # Add Custom Branded Domains Support

  1. New Tables
    - `custom_domains`
      - `id` (uuid, primary key)
      - `domain` (text, unique) - The custom domain (e.g., "go.yourbrand.com")
      - `is_verified` (boolean) - Whether domain ownership is verified
      - `is_active` (boolean) - Whether the domain is currently active
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)
  
  2. Changes to existing tables
    - Add `custom_domain_id` to `short_links` table (nullable foreign key)
    - This allows links to optionally use a custom domain
  
  3. Security
    - Enable RLS on `custom_domains` table
    - Add policies for reading and managing domains
*/

-- Create custom_domains table
CREATE TABLE IF NOT EXISTS custom_domains (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  domain text UNIQUE NOT NULL,
  is_verified boolean DEFAULT false,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Add custom_domain_id to short_links
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'short_links' AND column_name = 'custom_domain_id'
  ) THEN
    ALTER TABLE short_links ADD COLUMN custom_domain_id uuid REFERENCES custom_domains(id);
  END IF;
END $$;

-- Enable RLS
ALTER TABLE custom_domains ENABLE ROW LEVEL SECURITY;

-- Policies for custom_domains
CREATE POLICY "Anyone can view active verified domains"
  ON custom_domains
  FOR SELECT
  USING (is_verified = true AND is_active = true);

CREATE POLICY "System can insert domains"
  ON custom_domains
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY "System can update domains"
  ON custom_domains
  FOR UPDATE
  USING (true)
  WITH CHECK (true);

CREATE POLICY "System can delete domains"
  ON custom_domains
  FOR DELETE
  USING (true);