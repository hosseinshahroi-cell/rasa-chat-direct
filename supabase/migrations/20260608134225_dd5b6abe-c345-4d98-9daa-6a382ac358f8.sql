
-- 1. message_reactions
CREATE TABLE public.message_reactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  emoji text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (message_id, user_id, emoji)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.message_reactions TO authenticated;
GRANT ALL ON public.message_reactions TO service_role;
ALTER TABLE public.message_reactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Chat participants can view reactions"
ON public.message_reactions FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.messages m WHERE m.id = message_id AND (m.sender_id = auth.uid() OR m.receiver_id = auth.uid()))
  OR has_role(auth.uid(), 'admin'::public.app_role)
);
CREATE POLICY "Chat participants can react"
ON public.message_reactions FOR INSERT TO authenticated WITH CHECK (
  auth.uid() = user_id
  AND EXISTS (SELECT 1 FROM public.messages m WHERE m.id = message_id AND (m.sender_id = auth.uid() OR m.receiver_id = auth.uid()))
);
CREATE POLICY "Users delete own reactions"
ON public.message_reactions FOR DELETE TO authenticated USING (auth.uid() = user_id);

ALTER PUBLICATION supabase_realtime ADD TABLE public.message_reactions;

-- 2. reports
CREATE TABLE public.reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id uuid NOT NULL,
  reported_user_id uuid NOT NULL,
  subject text NOT NULL,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by uuid
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reports TO authenticated;
GRANT ALL ON public.reports TO service_role;
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users insert own reports" ON public.reports FOR INSERT TO authenticated WITH CHECK (auth.uid() = reporter_id);
CREATE POLICY "Reporter sees own reports" ON public.reports FOR SELECT TO authenticated USING (auth.uid() = reporter_id OR has_role(auth.uid(), 'admin'::public.app_role));
CREATE POLICY "Admins update reports" ON public.reports FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::public.app_role));

-- 3. app_settings
CREATE TABLE public.app_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.app_settings TO authenticated;
GRANT ALL ON public.app_settings TO service_role;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "All authenticated can read settings" ON public.app_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage settings" ON public.app_settings FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::public.app_role));

INSERT INTO public.app_settings(key, value) VALUES
  ('global_locks', '{"text":false,"voice":false,"video":false,"file":false,"image":false}'::jsonb)
ON CONFLICT DO NOTHING;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_scammer boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS lock_text boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS lock_voice boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS lock_video boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS lock_file boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS lock_image boolean NOT NULL DEFAULT false;

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS is_announcement boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.block_suspended_senders()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  p RECORD;
  g jsonb;
  atype text := COALESCE(NEW.attachment_type, 'text');
BEGIN
  IF NEW.is_announcement AND public.has_role(NEW.sender_id, 'admin'::public.app_role) THEN
    RETURN NEW;
  END IF;

  SELECT suspended_until, lock_text, lock_voice, lock_video, lock_file, lock_image
    INTO p FROM public.profiles WHERE id = NEW.sender_id;

  IF p.suspended_until IS NOT NULL AND p.suspended_until > now() THEN
    RAISE EXCEPTION 'User is suspended until %', p.suspended_until;
  END IF;

  SELECT value INTO g FROM public.app_settings WHERE key = 'global_locks';

  IF atype = 'text' THEN
    IF p.lock_text THEN RAISE EXCEPTION 'ارسال پیام متنی برای حساب شما غیرفعال است'; END IF;
    IF COALESCE((g->>'text')::boolean, false) THEN RAISE EXCEPTION 'ارسال پیام متنی موقتاً برای همه غیرفعال است'; END IF;
  ELSIF atype = 'audio' THEN
    IF p.lock_voice THEN RAISE EXCEPTION 'ارسال پیام صوتی برای حساب شما غیرفعال است'; END IF;
    IF COALESCE((g->>'voice')::boolean, false) THEN RAISE EXCEPTION 'ارسال پیام صوتی موقتاً غیرفعال است'; END IF;
  ELSIF atype = 'video' THEN
    IF p.lock_video THEN RAISE EXCEPTION 'ارسال ویدیو برای حساب شما غیرفعال است'; END IF;
    IF COALESCE((g->>'video')::boolean, false) THEN RAISE EXCEPTION 'ارسال ویدیو موقتاً غیرفعال است'; END IF;
  ELSIF atype = 'image' THEN
    IF p.lock_image THEN RAISE EXCEPTION 'ارسال عکس برای حساب شما غیرفعال است'; END IF;
    IF COALESCE((g->>'image')::boolean, false) THEN RAISE EXCEPTION 'ارسال عکس موقتاً غیرفعال است'; END IF;
  ELSIF atype = 'file' THEN
    IF p.lock_file THEN RAISE EXCEPTION 'ارسال فایل برای حساب شما غیرفعال است'; END IF;
    IF COALESCE((g->>'file')::boolean, false) THEN RAISE EXCEPTION 'ارسال فایل موقتاً غیرفعال است'; END IF;
  END IF;

  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.block_suspended_senders() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_block_suspended_senders ON public.messages;
CREATE TRIGGER trg_block_suspended_senders
BEFORE INSERT ON public.messages
FOR EACH ROW EXECUTE FUNCTION public.block_suspended_senders();

CREATE OR REPLACE FUNCTION public.report_user(reported uuid, p_subject text, p_reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE rid uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  IF reported = auth.uid() THEN RAISE EXCEPTION 'Cannot report yourself'; END IF;
  IF length(coalesce(p_subject,'')) = 0 OR length(p_subject) > 100 THEN RAISE EXCEPTION 'Invalid subject'; END IF;
  IF length(coalesce(p_reason,'')) = 0 OR length(p_reason) > 1000 THEN RAISE EXCEPTION 'Invalid reason'; END IF;
  INSERT INTO public.reports(reporter_id, reported_user_id, subject, reason)
  VALUES (auth.uid(), reported, p_subject, p_reason) RETURNING id INTO rid;
  RETURN rid;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_list_reports(only_open boolean DEFAULT true)
RETURNS TABLE(
  id uuid, reporter_id uuid, reported_user_id uuid,
  reporter_username text, reported_username text,
  subject text, reason text, status text, created_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN RAISE EXCEPTION 'Access denied'; END IF;
  RETURN QUERY
  SELECT r.id, r.reporter_id, r.reported_user_id,
         pr.username, pu.username,
         r.subject, r.reason, r.status, r.created_at
  FROM public.reports r
  JOIN public.profiles pr ON pr.id = r.reporter_id
  JOIN public.profiles pu ON pu.id = r.reported_user_id
  WHERE (NOT only_open) OR r.status = 'open'
  ORDER BY r.created_at DESC
  LIMIT 200;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_resolve_report(report_id uuid, new_status text DEFAULT 'resolved')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN RAISE EXCEPTION 'Access denied'; END IF;
  UPDATE public.reports SET status = new_status, resolved_at = now(), resolved_by = auth.uid() WHERE id = report_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_delete_user(target uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN RAISE EXCEPTION 'Access denied'; END IF;
  DELETE FROM auth.users WHERE id = target;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_user_flags(
  target uuid,
  p_is_scammer boolean DEFAULT NULL,
  p_lock_text boolean DEFAULT NULL,
  p_lock_voice boolean DEFAULT NULL,
  p_lock_video boolean DEFAULT NULL,
  p_lock_file boolean DEFAULT NULL,
  p_lock_image boolean DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN RAISE EXCEPTION 'Access denied'; END IF;
  UPDATE public.profiles SET
    is_scammer = COALESCE(p_is_scammer, is_scammer),
    lock_text = COALESCE(p_lock_text, lock_text),
    lock_voice = COALESCE(p_lock_voice, lock_voice),
    lock_video = COALESCE(p_lock_video, lock_video),
    lock_file = COALESCE(p_lock_file, lock_file),
    lock_image = COALESCE(p_lock_image, lock_image)
  WHERE id = target;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_global_locks(locks jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN RAISE EXCEPTION 'Access denied'; END IF;
  INSERT INTO public.app_settings(key, value, updated_at)
  VALUES ('global_locks', locks, now())
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_broadcast(message text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE n integer := 0;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF length(coalesce(message,'')) = 0 OR length(message) > 2000 THEN RAISE EXCEPTION 'Invalid message'; END IF;
  INSERT INTO public.messages(sender_id, receiver_id, content, is_announcement)
  SELECT auth.uid(), p.id, message, true FROM public.profiles p WHERE p.id <> auth.uid();
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

DROP FUNCTION IF EXISTS public.admin_list_users(text);
CREATE OR REPLACE FUNCTION public.admin_list_users(search_query text DEFAULT '')
RETURNS TABLE(
  id uuid, username text, display_name text, avatar_url text,
  is_verified boolean, is_scammer boolean,
  lock_text boolean, lock_voice boolean, lock_video boolean, lock_file boolean, lock_image boolean,
  suspended_until timestamptz, created_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN RAISE EXCEPTION 'Access denied'; END IF;
  RETURN QUERY
  SELECT p.id, p.username, p.display_name, p.avatar_url,
         p.is_verified, p.is_scammer,
         p.lock_text, p.lock_voice, p.lock_video, p.lock_file, p.lock_image,
         p.suspended_until, p.created_at
  FROM public.profiles p
  WHERE search_query = ''
     OR p.username ILIKE '%' || search_query || '%'
     OR COALESCE(p.display_name, '') ILIKE '%' || search_query || '%'
  ORDER BY p.created_at DESC
  LIMIT 200;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_stats()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE result jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN RAISE EXCEPTION 'Access denied'; END IF;
  SELECT jsonb_build_object(
    'users', (SELECT count(*) FROM public.profiles),
    'messages', (SELECT count(*) FROM public.messages WHERE NOT deleted_for_everyone),
    'verified', (SELECT count(*) FROM public.profiles WHERE is_verified),
    'suspended', (SELECT count(*) FROM public.profiles WHERE suspended_until > now()),
    'scammers', (SELECT count(*) FROM public.profiles WHERE is_scammer),
    'online_now', (SELECT count(*) FROM public.profiles WHERE last_seen_at > now() - interval '2 minutes'),
    'active_today', (SELECT count(*) FROM public.profiles WHERE last_seen_at > now() - interval '1 day'),
    'new_today', (SELECT count(*) FROM public.profiles WHERE created_at > now() - interval '1 day'),
    'messages_today', (SELECT count(*) FROM public.messages WHERE created_at > now() - interval '1 day' AND NOT deleted_for_everyone),
    'open_reports', (SELECT count(*) FROM public.reports WHERE status = 'open')
  ) INTO result;
  RETURN result;
END;
$$;
