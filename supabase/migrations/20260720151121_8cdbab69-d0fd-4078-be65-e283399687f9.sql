
-- Explicit RLS policies on storage.objects scoped to the private 'briefs' bucket.
-- The bucket is private; audio is served via signed URLs generated server-side.
-- Only service_role (edge functions) is permitted at the storage layer.

DROP POLICY IF EXISTS "briefs service_role select" ON storage.objects;
DROP POLICY IF EXISTS "briefs service_role insert" ON storage.objects;
DROP POLICY IF EXISTS "briefs service_role update" ON storage.objects;
DROP POLICY IF EXISTS "briefs service_role delete" ON storage.objects;
DROP POLICY IF EXISTS "briefs deny anon" ON storage.objects;
DROP POLICY IF EXISTS "briefs deny authenticated" ON storage.objects;

CREATE POLICY "briefs service_role select"
ON storage.objects FOR SELECT
TO service_role
USING (bucket_id = 'briefs');

CREATE POLICY "briefs service_role insert"
ON storage.objects FOR INSERT
TO service_role
WITH CHECK (bucket_id = 'briefs');

CREATE POLICY "briefs service_role update"
ON storage.objects FOR UPDATE
TO service_role
USING (bucket_id = 'briefs')
WITH CHECK (bucket_id = 'briefs');

CREATE POLICY "briefs service_role delete"
ON storage.objects FOR DELETE
TO service_role
USING (bucket_id = 'briefs');
