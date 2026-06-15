GRANT SELECT (is_scammer) ON public.profiles TO authenticated;

DROP POLICY IF EXISTS "Story media viewable by authenticated users" ON storage.objects;
CREATE POLICY "Story media viewable by authenticated users"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'chat-attachments'
    AND EXISTS (
      SELECT 1
      FROM public.stories s
      WHERE s.media_url = storage.objects.name
        AND (s.expires_at > now() OR s.user_id = (SELECT auth.uid()))
    )
  );