-- Bucket voor garantiebewijzen (PDF's). Publiek leesbaar, upload via service role.
INSERT INTO storage.buckets (id, name, public)
VALUES ('garantiebewijzen', 'garantiebewijzen', true)
ON CONFLICT (id) DO NOTHING;

-- Iedereen mag bestanden in deze bucket lezen (publieke link).
CREATE POLICY "Public read garantiebewijzen"
ON storage.objects FOR SELECT
USING (bucket_id = 'garantiebewijzen');

-- Alleen service role kan uploaden (via API met service key); anon/authenticated niet nodig voor upload.
CREATE POLICY "Service upload garantiebewijzen"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'garantiebewijzen');
