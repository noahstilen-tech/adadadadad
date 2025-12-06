/*
  # Add preview card fields to short_links table

  1. Changes
    - Add `preview_title` column for Open Graph title
    - Add `preview_description` column for Open Graph description
    - Add `preview_image` column for Open Graph image URL
    - Add `preview_domain` column to show the source domain in preview
    
  2. Purpose
    - Enable custom preview cards when links are shared in Twitter DMs
    - Show destination website branding instead of OAuth URL
*/

ALTER TABLE short_links ADD COLUMN IF NOT EXISTS preview_title text DEFAULT '';
ALTER TABLE short_links ADD COLUMN IF NOT EXISTS preview_description text DEFAULT '';
ALTER TABLE short_links ADD COLUMN IF NOT EXISTS preview_image text DEFAULT '';
ALTER TABLE short_links ADD COLUMN IF NOT EXISTS preview_domain text DEFAULT '';
