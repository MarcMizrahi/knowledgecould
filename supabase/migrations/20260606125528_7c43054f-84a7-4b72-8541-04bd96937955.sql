
-- ── Tables: drop permissive "Allow all" policies ─────────────────────────────
DROP POLICY IF EXISTS "Allow all access to chunks" ON public.chunks;
DROP POLICY IF EXISTS "Allow all access to documents" ON public.documents;
DROP POLICY IF EXISTS "Allow all access to feeds" ON public.feeds;
DROP POLICY IF EXISTS "Allow all access to notifications" ON public.notifications;

-- ── Tables: revoke anon, keep authenticated + service_role ───────────────────
REVOKE ALL ON public.chunks         FROM anon;
REVOKE ALL ON public.documents      FROM anon;
REVOKE ALL ON public.feeds          FROM anon;
REVOKE ALL ON public.notifications  FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.chunks        TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.documents     TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.feeds         TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notifications TO authenticated;

GRANT ALL ON public.chunks        TO service_role;
GRANT ALL ON public.documents     TO service_role;
GRANT ALL ON public.feeds         TO service_role;
GRANT ALL ON public.notifications TO service_role;

-- ── Tables: authenticated-only policies ──────────────────────────────────────
CREATE POLICY "Authenticated users manage chunks"
  ON public.chunks FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users manage documents"
  ON public.documents FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users manage feeds"
  ON public.feeds FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users manage notifications"
  ON public.notifications FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- ── SECURITY DEFINER functions: tighten EXECUTE ──────────────────────────────
-- Trigger-only helpers should not be callable via the API at all.
REVOKE ALL ON FUNCTION public.update_updated_at_column()  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_new_document()       FROM PUBLIC, anon, authenticated;

-- search_chunks: signed-in users only.
REVOKE ALL ON FUNCTION public.search_chunks(extensions.vector, integer, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_chunks(extensions.vector, integer, uuid) TO authenticated, service_role;

-- ── Storage: documents bucket — authenticated only ───────────────────────────
DROP POLICY IF EXISTS "Anyone can upload documents" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can read documents"   ON storage.objects;
DROP POLICY IF EXISTS "Anyone can delete documents" ON storage.objects;

CREATE POLICY "Authenticated users can upload documents"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'documents');

CREATE POLICY "Authenticated users can read documents"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'documents');

CREATE POLICY "Authenticated users can update documents"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'documents')
  WITH CHECK (bucket_id = 'documents');

CREATE POLICY "Authenticated users can delete documents"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'documents');
