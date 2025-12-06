/*
  # Create Storage for Preview Images

  1. Storage Setup
    - Create a public bucket called 'preview-images'
    - Allow anyone to read files (for preview cards)
    - Allow anyone to upload files (simplifies upload flow)
    
  2. Security
    - Files are public for preview card access
    - Bucket has size limits to prevent abuse
*/

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'preview-images',
  'preview-images',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'storage' 
    AND tablename = 'objects' 
    AND policyname = 'Anyone can read preview images'
  ) THEN
    CREATE POLICY "Anyone can read preview images"
    ON storage.objects FOR SELECT
    USING (bucket_id = 'preview-images');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'storage' 
    AND tablename = 'objects' 
    AND policyname = 'Anyone can upload preview images'
  ) THEN
    CREATE POLICY "Anyone can upload preview images"
    ON storage.objects FOR INSERT
    WITH CHECK (bucket_id = 'preview-images');
  END IF;
END $$;
