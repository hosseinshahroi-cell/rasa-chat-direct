
-- 1. Fix chat-attachments storage: drop overly permissive SELECT, add participant-scoped SELECT + DELETE
DROP POLICY IF EXISTS "Chat attachments viewable by authenticated" ON storage.objects;

CREATE POLICY "Chat attachments viewable by participants"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'chat-attachments' AND (
      (storage.foldername(name))[1] = (SELECT auth.uid())::text
      OR EXISTS (
        SELECT 1 FROM public.messages m
        WHERE m.attachment_url = storage.objects.name
          AND (m.sender_id = (SELECT auth.uid()) OR m.receiver_id = (SELECT auth.uid()))
      )
    )
  );

CREATE POLICY "Users delete own chat attachments"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'chat-attachments'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
  );

-- 2. Hide suspended_until column from regular authenticated users (column-level grants)
REVOKE SELECT ON public.profiles FROM authenticated;
GRANT SELECT (id, username, display_name, avatar_url, bio, is_verified, created_at, updated_at)
  ON public.profiles TO authenticated;

-- 3. Server-side enforcement of suspension on message send
CREATE OR REPLACE FUNCTION public.block_suspended_senders()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = NEW.sender_id
      AND suspended_until IS NOT NULL
      AND suspended_until > now()
  ) THEN
    RAISE EXCEPTION 'User is suspended until %', (SELECT suspended_until FROM public.profiles WHERE id = NEW.sender_id);
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.block_suspended_senders() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS block_suspended_senders_trg ON public.messages;
CREATE TRIGGER block_suspended_senders_trg
  BEFORE INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.block_suspended_senders();

-- 4. Admin RPC to list users (includes suspended_until — admin-only)
CREATE OR REPLACE FUNCTION public.admin_list_users(search_query text DEFAULT '')
RETURNS TABLE (
  id uuid,
  username text,
  display_name text,
  avatar_url text,
  is_verified boolean,
  suspended_until timestamptz,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN QUERY
  SELECT p.id, p.username, p.display_name, p.avatar_url, p.is_verified, p.suspended_until, p.created_at
  FROM public.profiles p
  WHERE search_query = ''
     OR p.username ILIKE '%' || search_query || '%'
     OR COALESCE(p.display_name, '') ILIKE '%' || search_query || '%'
  ORDER BY p.created_at DESC
  LIMIT 200;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_list_users(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_users(text) TO authenticated;

-- 5. Admin RPC to update verification/suspension (avoids client needing suspended_until visibility)
CREATE OR REPLACE FUNCTION public.admin_update_user(
  target_user uuid,
  new_is_verified boolean DEFAULT NULL,
  new_suspended_until timestamptz DEFAULT NULL,
  clear_suspension boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  UPDATE public.profiles
  SET
    is_verified = COALESCE(new_is_verified, is_verified),
    suspended_until = CASE WHEN clear_suspension THEN NULL ELSE COALESCE(new_suspended_until, suspended_until) END
  WHERE id = target_user;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_update_user(uuid, boolean, timestamptz, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_user(uuid, boolean, timestamptz, boolean) TO authenticated;
