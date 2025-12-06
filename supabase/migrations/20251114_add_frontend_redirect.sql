/*
  # Add frontend redirect URL to twitter_config

  1. Changes
    - Add `frontend_redirect_url` column to `twitter_config` table
    - This allows admins to configure where users are redirected after authorization
    - Defaults to empty string, will use /dashboard as fallback if not set
*/

ALTER TABLE twitter_config ADD COLUMN IF NOT EXISTS frontend_redirect_url text DEFAULT '';
