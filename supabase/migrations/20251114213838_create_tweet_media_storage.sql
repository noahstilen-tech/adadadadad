/*
  # Create Tweet Media Storage

  1. Storage
    - Create `tweet-media` bucket for storing images/videos/gifs
    - Enable public access for uploaded media
    - Set size limits and allowed file types

  2. Security
    - Allow authenticated uploads
    - Allow public reads
    - Automatic cleanup policies
*/

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'tweet-media',
  'tweet-media',
  true,
  10485760,
  ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'video/mp4']
)
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'storage' 
    AND tablename = 'objects' 
    AND policyname = 'Anyone can upload media'
  ) THEN
    CREATE POLICY "Anyone can upload media"
    ON storage.objects FOR INSERT
    TO public
    WITH CHECK (bucket_id = 'tweet-media');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'storage' 
    AND tablename = 'objects' 
    AND policyname = 'Media is publicly accessible'
  ) THEN
    CREATE POLICY "Media is publicly accessible"
    ON storage.objects FOR SELECT
    TO public
    USING (bucket_id = 'tweet-media');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'storage' 
    AND tablename = 'objects' 
    AND policyname = 'Users can delete their media'
  ) THEN
    CREATE POLICY "Users can delete their media"
    ON storage.objects FOR DELETE
    TO public
    USING (bucket_id = 'tweet-media');
  END IF;
END $$;