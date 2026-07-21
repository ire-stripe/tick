
CREATE POLICY "briefs public read" ON storage.objects
FOR SELECT USING (bucket_id = 'briefs');
