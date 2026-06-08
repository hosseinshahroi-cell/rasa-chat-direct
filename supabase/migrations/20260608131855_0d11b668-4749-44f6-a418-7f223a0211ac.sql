
-- 1. Schema additions to messages
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS reply_to_id uuid REFERENCES public.messages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS edited_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_for_everyone boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS deleted_for uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS is_pinned boolean NOT NULL DEFAULT false;

-- 2. Last seen tracking on profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz NOT NULL DEFAULT now();

GRANT SELECT (id, username, display_name, avatar_url, bio, is_verified, created_at, updated_at, last_seen_at)
  ON public.profiles TO authenticated;

-- 3. Broaden message UPDATE policy so sender can edit/delete and either party can pin/mark-read
DROP POLICY IF EXISTS "Users update own received messages (mark read)" ON public.messages;
CREATE POLICY "Participants can update messages" ON public.messages
  FOR UPDATE TO authenticated
  USING (auth.uid() = sender_id OR auth.uid() = receiver_id OR public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (auth.uid() = sender_id OR auth.uid() = receiver_id OR public.has_role(auth.uid(), 'admin'::public.app_role));

-- 4. touch_last_seen RPC
CREATE OR REPLACE FUNCTION public.touch_last_seen()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.profiles SET last_seen_at = now() WHERE id = auth.uid();
$$;
REVOKE EXECUTE ON FUNCTION public.touch_last_seen() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.touch_last_seen() TO authenticated;

-- 5. Admin: delete message for everyone
CREATE OR REPLACE FUNCTION public.admin_delete_message(msg_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  UPDATE public.messages
  SET deleted_for_everyone = true,
      content = NULL,
      attachment_url = NULL,
      attachment_type = NULL
  WHERE id = msg_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_delete_message(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_message(uuid) TO authenticated;

-- 6. Richer admin stats
CREATE OR REPLACE FUNCTION public.admin_stats()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE result jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  SELECT jsonb_build_object(
    'users', (SELECT count(*) FROM public.profiles),
    'messages', (SELECT count(*) FROM public.messages WHERE NOT deleted_for_everyone),
    'verified', (SELECT count(*) FROM public.profiles WHERE is_verified),
    'suspended', (SELECT count(*) FROM public.profiles WHERE suspended_until > now()),
    'online_now', (SELECT count(*) FROM public.profiles WHERE last_seen_at > now() - interval '2 minutes'),
    'active_today', (SELECT count(*) FROM public.profiles WHERE last_seen_at > now() - interval '1 day'),
    'new_today', (SELECT count(*) FROM public.profiles WHERE created_at > now() - interval '1 day'),
    'messages_today', (SELECT count(*) FROM public.messages WHERE created_at > now() - interval '1 day' AND NOT deleted_for_everyone)
  ) INTO result;
  RETURN result;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_stats() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_stats() TO authenticated;

-- 7. Admin: list recent messages with sender/receiver info
CREATE OR REPLACE FUNCTION public.admin_recent_messages(limit_n int DEFAULT 50)
RETURNS TABLE (
  id uuid,
  sender_id uuid,
  receiver_id uuid,
  sender_username text,
  receiver_username text,
  content text,
  attachment_type text,
  created_at timestamptz,
  deleted_for_everyone boolean
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
  SELECT m.id, m.sender_id, m.receiver_id,
         ps.username, pr.username,
         m.content, m.attachment_type, m.created_at, m.deleted_for_everyone
  FROM public.messages m
  JOIN public.profiles ps ON ps.id = m.sender_id
  JOIN public.profiles pr ON pr.id = m.receiver_id
  ORDER BY m.created_at DESC
  LIMIT limit_n;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_recent_messages(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_recent_messages(int) TO authenticated;
