
GRANT SELECT, INSERT, UPDATE, DELETE ON public.documents TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.chunks TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notifications TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.feeds TO anon, authenticated;
GRANT ALL ON public.documents, public.chunks, public.notifications, public.feeds TO service_role;

DROP POLICY IF EXISTS "Anon manage documents" ON public.documents;
DROP POLICY IF EXISTS "Anon manage chunks" ON public.chunks;
DROP POLICY IF EXISTS "Anon manage notifications" ON public.notifications;
DROP POLICY IF EXISTS "Anon manage feeds" ON public.feeds;

CREATE POLICY "Anon manage documents" ON public.documents FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Anon manage chunks" ON public.chunks FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Anon manage notifications" ON public.notifications FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Anon manage feeds" ON public.feeds FOR ALL TO anon USING (true) WITH CHECK (true);
