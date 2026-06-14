ALTER TABLE public.groups ADD COLUMN IF NOT EXISTS is_channel boolean NOT NULL DEFAULT false;
ALTER TABLE public.groups ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE public.groups ADD COLUMN IF NOT EXISTS public_username text;
ALTER TABLE public.groups ADD COLUMN IF NOT EXISTS member_can_invite boolean NOT NULL DEFAULT true;
CREATE UNIQUE INDEX IF NOT EXISTS groups_public_username_unique ON public.groups (lower(public_username)) WHERE public_username IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.stories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  media_url text NOT NULL,
  media_type text NOT NULL CHECK (media_type IN ('image','video')),
  caption text,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stories TO authenticated;
GRANT ALL ON public.stories TO service_role;
ALTER TABLE public.stories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated users can view active stories" ON public.stories;
DROP POLICY IF EXISTS "Users can create own stories" ON public.stories;
DROP POLICY IF EXISTS "Users can delete own stories" ON public.stories;
CREATE POLICY "Authenticated users can view active stories" ON public.stories FOR SELECT TO authenticated USING (expires_at > now() OR user_id = auth.uid());
CREATE POLICY "Users can create own stories" ON public.stories FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users can delete own stories" ON public.stories FOR DELETE TO authenticated USING (user_id = auth.uid());

CREATE TABLE IF NOT EXISTS public.story_views (
  story_id uuid NOT NULL REFERENCES public.stories(id) ON DELETE CASCADE,
  viewer_id uuid NOT NULL,
  viewed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (story_id, viewer_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.story_views TO authenticated;
GRANT ALL ON public.story_views TO service_role;
ALTER TABLE public.story_views ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Story owners can view viewers" ON public.story_views;
DROP POLICY IF EXISTS "Users can mark own story view" ON public.story_views;
DROP POLICY IF EXISTS "Users can refresh own story view" ON public.story_views;
CREATE POLICY "Story owners can view viewers" ON public.story_views FOR SELECT TO authenticated USING (
  viewer_id = auth.uid() OR EXISTS (SELECT 1 FROM public.stories s WHERE s.id = story_id AND s.user_id = auth.uid())
);
CREATE POLICY "Users can mark own story view" ON public.story_views FOR INSERT TO authenticated WITH CHECK (viewer_id = auth.uid());
CREATE POLICY "Users can refresh own story view" ON public.story_views FOR UPDATE TO authenticated USING (viewer_id = auth.uid()) WITH CHECK (viewer_id = auth.uid());

CREATE OR REPLACE FUNCTION public.create_group(p_name text, p_avatar text DEFAULT NULL::text, p_members uuid[] DEFAULT '{}'::uuid[])
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE gid uuid; uid uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  IF length(coalesce(p_name,'')) = 0 OR length(p_name) > 80 THEN RAISE EXCEPTION 'Invalid name'; END IF;
  INSERT INTO public.groups(name, avatar_url, owner_id, is_channel, lock_members_send) VALUES (p_name, p_avatar, auth.uid(), false, false) RETURNING id INTO gid;
  INSERT INTO public.group_members(group_id, user_id, role) VALUES (gid, auth.uid(), 'owner');
  FOREACH uid IN ARRAY p_members LOOP
    IF uid <> auth.uid() THEN
      INSERT INTO public.group_members(group_id, user_id, role) VALUES (gid, uid, 'member') ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;
  RETURN gid;
END $$;

CREATE OR REPLACE FUNCTION public.create_channel(p_name text, p_avatar text DEFAULT NULL::text, p_description text DEFAULT NULL::text, p_public_username text DEFAULT NULL::text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE gid uuid; normalized text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  IF length(coalesce(p_name,'')) = 0 OR length(p_name) > 80 THEN RAISE EXCEPTION 'Invalid name'; END IF;
  normalized := NULLIF(lower(regexp_replace(coalesce(p_public_username,''), '^@', '')), '');
  IF normalized IS NOT NULL AND normalized !~ '^[a-z0-9_]{4,30}$' THEN RAISE EXCEPTION 'Invalid channel id'; END IF;
  IF normalized IS NOT NULL AND EXISTS (SELECT 1 FROM public.groups WHERE lower(public_username)=normalized) THEN RAISE EXCEPTION 'Channel id exists'; END IF;
  INSERT INTO public.groups(name, avatar_url, owner_id, is_channel, lock_members_send, description, public_username, member_can_invite)
  VALUES (p_name, p_avatar, auth.uid(), true, true, p_description, normalized, false) RETURNING id INTO gid;
  INSERT INTO public.group_members(group_id, user_id, role) VALUES (gid, auth.uid(), 'owner');
  RETURN gid;
END $$;

DROP FUNCTION IF EXISTS public.my_groups();
CREATE FUNCTION public.my_groups()
RETURNS TABLE(id uuid, name text, avatar_url text, owner_id uuid, my_role text, member_count bigint, last_msg_at timestamptz, is_channel boolean, description text, public_username text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT g.id, g.name, g.avatar_url, g.owner_id, gm.role,
    (SELECT count(*) FROM public.group_members x WHERE x.group_id=g.id),
    (SELECT max(created_at) FROM public.messages m WHERE m.group_id=g.id AND NOT m.deleted_for_everyone),
    g.is_channel, g.description, g.public_username
  FROM public.groups g JOIN public.group_members gm ON gm.group_id=g.id
  WHERE gm.user_id = auth.uid()
  ORDER BY g.created_at DESC;
$$;

CREATE OR REPLACE FUNCTION public.group_update_settings(p_gid uuid, p_name text DEFAULT NULL::text, p_avatar text DEFAULT NULL::text, p_lock_members boolean DEFAULT NULL::boolean, p_description text DEFAULT NULL::text, p_public_username text DEFAULT NULL::text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE my_role text; normalized text;
BEGIN
  my_role := public.group_role(p_gid, auth.uid());
  IF my_role NOT IN ('owner','admin') THEN RAISE EXCEPTION 'No permission'; END IF;
  normalized := CASE WHEN p_public_username IS NULL THEN NULL ELSE NULLIF(lower(regexp_replace(p_public_username, '^@', '')), '') END;
  IF normalized IS NOT NULL AND normalized !~ '^[a-z0-9_]{4,30}$' THEN RAISE EXCEPTION 'Invalid id'; END IF;
  IF normalized IS NOT NULL AND EXISTS (SELECT 1 FROM public.groups WHERE id <> p_gid AND lower(public_username)=normalized) THEN RAISE EXCEPTION 'Id exists'; END IF;
  UPDATE public.groups SET
    name = COALESCE(p_name, name),
    avatar_url = COALESCE(p_avatar, avatar_url),
    lock_members_send = COALESCE(p_lock_members, lock_members_send),
    description = COALESCE(p_description, description),
    public_username = COALESCE(normalized, public_username),
    updated_at = now()
  WHERE id=p_gid;
END $$;

CREATE OR REPLACE FUNCTION public.global_search(p_query text)
RETURNS TABLE(kind text, id uuid, username text, name text, avatar_url text, is_verified boolean, member_count bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE q text := trim(coalesce(p_query,''));
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  IF length(q) < 1 THEN RETURN; END IF;
  RETURN QUERY
  SELECT 'user'::text, p.id, p.username, COALESCE(p.display_name, p.username), p.avatar_url, p.is_verified, 0::bigint
  FROM public.profiles p
  WHERE p.id <> auth.uid() AND (p.username ILIKE '%'||q||'%' OR COALESCE(p.display_name,'') ILIKE '%'||q||'%')
  LIMIT 20;
  RETURN QUERY
  SELECT CASE WHEN g.is_channel THEN 'channel' ELSE 'group' END::text, g.id, g.public_username, g.name, g.avatar_url, false, (SELECT count(*) FROM public.group_members gm WHERE gm.group_id=g.id)
  FROM public.groups g
  WHERE public.is_group_member(g.id, auth.uid()) AND (g.name ILIKE '%'||q||'%' OR COALESCE(g.public_username,'') ILIKE '%'||q||'%')
  LIMIT 20;
END $$;

CREATE OR REPLACE FUNCTION public.active_stories()
RETURNS TABLE(id uuid, user_id uuid, username text, display_name text, avatar_url text, media_url text, media_type text, caption text, created_at timestamptz, expires_at timestamptz, view_count bigint, viewed_by_me boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.id, s.user_id, p.username, p.display_name, p.avatar_url, s.media_url, s.media_type, s.caption, s.created_at, s.expires_at,
    (SELECT count(*) FROM public.story_views v WHERE v.story_id=s.id),
    EXISTS(SELECT 1 FROM public.story_views v WHERE v.story_id=s.id AND v.viewer_id=auth.uid())
  FROM public.stories s JOIN public.profiles p ON p.id=s.user_id
  WHERE s.expires_at > now()
  ORDER BY s.created_at DESC;
$$;

CREATE OR REPLACE FUNCTION public.view_story(p_story uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.stories WHERE id=p_story AND expires_at > now()) THEN RAISE EXCEPTION 'Story expired'; END IF;
  INSERT INTO public.story_views(story_id, viewer_id, viewed_at) VALUES (p_story, auth.uid(), now())
  ON CONFLICT (story_id, viewer_id) DO UPDATE SET viewed_at=now();
END $$;

CREATE OR REPLACE FUNCTION public.block_suspended_senders()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  p RECORD; g jsonb; grp RECORD;
  atype text := COALESCE(NEW.attachment_type, 'text');
BEGIN
  IF NEW.is_announcement AND public.has_role(NEW.sender_id, 'admin'::public.app_role) THEN RETURN NEW; END IF;
  SELECT suspended_until, lock_text, lock_voice, lock_video, lock_file, lock_image
    INTO p FROM public.profiles WHERE id = NEW.sender_id;
  IF p.suspended_until IS NOT NULL AND p.suspended_until > now() THEN
    RAISE EXCEPTION 'User is suspended until %', p.suspended_until;
  END IF;
  SELECT value INTO g FROM public.app_settings WHERE key = 'global_locks';
  IF atype = 'text' AND (p.lock_text OR COALESCE((g->>'text')::boolean,false)) THEN RAISE EXCEPTION 'ارسال متن غیرفعال است'; END IF;
  IF atype = 'audio' AND (p.lock_voice OR COALESCE((g->>'voice')::boolean,false)) THEN RAISE EXCEPTION 'ارسال صوت غیرفعال است'; END IF;
  IF atype = 'video' AND (p.lock_video OR COALESCE((g->>'video')::boolean,false)) THEN RAISE EXCEPTION 'ارسال ویدیو غیرفعال است'; END IF;
  IF atype = 'image' AND (p.lock_image OR COALESCE((g->>'image')::boolean,false)) THEN RAISE EXCEPTION 'ارسال عکس غیرفعال است'; END IF;
  IF atype = 'file' AND (p.lock_file OR COALESCE((g->>'file')::boolean,false)) THEN RAISE EXCEPTION 'ارسال فایل غیرفعال است'; END IF;
  IF NEW.receiver_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.user_blocks WHERE blocker_id = NEW.receiver_id AND blocked_id = NEW.sender_id
  ) THEN RAISE EXCEPTION 'این کاربر شما را مسدود کرده است'; END IF;
  IF NEW.group_id IS NOT NULL THEN
    SELECT lock_members_send, is_channel INTO grp FROM public.groups WHERE id = NEW.group_id;
    IF (grp.lock_members_send OR grp.is_channel) AND public.group_role(NEW.group_id, NEW.sender_id) NOT IN ('owner','admin') THEN
      RAISE EXCEPTION 'ارسال در این گفتگو فقط برای ادمین‌هاست';
    END IF;
  END IF;
  RETURN NEW;
END $$;

ALTER TABLE public.stories REPLICA IDENTITY FULL;
ALTER TABLE public.story_views REPLICA IDENTITY FULL;
ALTER TABLE public.groups REPLICA IDENTITY FULL;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.stories; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.story_views; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.groups; EXCEPTION WHEN duplicate_object THEN NULL; END $$;