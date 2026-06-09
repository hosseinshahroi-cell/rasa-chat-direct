
CREATE TABLE public.groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  avatar_url text,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  invite_token text UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(12), 'hex'),
  lock_members_send boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.groups TO authenticated;
GRANT ALL ON public.groups TO service_role;
ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.group_members (
  group_id uuid NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('owner','admin','member')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.group_members TO authenticated;
GRANT ALL ON public.group_members TO service_role;
ALTER TABLE public.group_members ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_group_member(_gid uuid, _uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS(SELECT 1 FROM public.group_members WHERE group_id=_gid AND user_id=_uid);
$$;
CREATE OR REPLACE FUNCTION public.group_role(_gid uuid, _uid uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT role FROM public.group_members WHERE group_id=_gid AND user_id=_uid;
$$;

CREATE POLICY "members read group" ON public.groups FOR SELECT TO authenticated
  USING (public.is_group_member(id, auth.uid()));
CREATE POLICY "owner updates group" ON public.groups FOR UPDATE TO authenticated
  USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
CREATE POLICY "anyone can create group" ON public.groups FOR INSERT TO authenticated
  WITH CHECK (owner_id = auth.uid());
CREATE POLICY "owner deletes" ON public.groups FOR DELETE TO authenticated
  USING (owner_id = auth.uid());
CREATE POLICY "members read members" ON public.group_members FOR SELECT TO authenticated
  USING (public.is_group_member(group_id, auth.uid()));

CREATE TRIGGER groups_updated_at BEFORE UPDATE ON public.groups
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.messages
  ADD COLUMN group_id uuid REFERENCES public.groups(id) ON DELETE CASCADE,
  ADD COLUMN forwarded_from_id uuid REFERENCES public.messages(id) ON DELETE SET NULL;
ALTER TABLE public.messages ALTER COLUMN receiver_id DROP NOT NULL;
ALTER TABLE public.messages ADD CONSTRAINT messages_target_chk
  CHECK ((receiver_id IS NOT NULL AND group_id IS NULL) OR (group_id IS NOT NULL AND receiver_id IS NULL));

DROP POLICY IF EXISTS "Users read own messages" ON public.messages;
DROP POLICY IF EXISTS "Users send messages" ON public.messages;
DROP POLICY IF EXISTS "Users update own messages" ON public.messages;
DROP POLICY IF EXISTS "Users delete own messages" ON public.messages;

CREATE POLICY "read messages" ON public.messages FOR SELECT TO authenticated
USING (
  sender_id = auth.uid() OR receiver_id = auth.uid()
  OR (group_id IS NOT NULL AND public.is_group_member(group_id, auth.uid()))
);
CREATE POLICY "send messages" ON public.messages FOR INSERT TO authenticated
WITH CHECK (
  sender_id = auth.uid() AND (
    (receiver_id IS NOT NULL AND group_id IS NULL)
    OR (group_id IS NOT NULL AND public.is_group_member(group_id, auth.uid()))
  )
);
CREATE POLICY "update own msg" ON public.messages FOR UPDATE TO authenticated
USING (sender_id = auth.uid()) WITH CHECK (sender_id = auth.uid());
CREATE POLICY "delete own msg" ON public.messages FOR DELETE TO authenticated
USING (sender_id = auth.uid());

CREATE TABLE public.user_blocks (
  blocker_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  blocked_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id)
);
GRANT SELECT, INSERT, DELETE ON public.user_blocks TO authenticated;
GRANT ALL ON public.user_blocks TO service_role;
ALTER TABLE public.user_blocks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "manage own blocks" ON public.user_blocks FOR ALL TO authenticated
  USING (blocker_id = auth.uid()) WITH CHECK (blocker_id = auth.uid());

CREATE TABLE public.app_ratings (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  stars int NOT NULL CHECK (stars BETWEEN 1 AND 5),
  comment text CHECK (comment IS NULL OR length(comment) <= 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_ratings TO authenticated;
GRANT ALL ON public.app_ratings TO service_role;
ALTER TABLE public.app_ratings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anyone reads ratings" ON public.app_ratings FOR SELECT TO authenticated USING (true);
CREATE POLICY "own rating" ON public.app_ratings FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE TRIGGER app_ratings_updated_at BEFORE UPDATE ON public.app_ratings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.call_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_user uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  to_user uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  call_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('offer','answer','ice','ring','hangup','accept','reject')),
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, DELETE ON public.call_signals TO authenticated;
GRANT ALL ON public.call_signals TO service_role;
ALTER TABLE public.call_signals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read own signals" ON public.call_signals FOR SELECT TO authenticated
  USING (from_user = auth.uid() OR to_user = auth.uid());
CREATE POLICY "send signals" ON public.call_signals FOR INSERT TO authenticated
  WITH CHECK (from_user = auth.uid());
CREATE POLICY "delete own signals" ON public.call_signals FOR DELETE TO authenticated
  USING (from_user = auth.uid() OR to_user = auth.uid());
CREATE INDEX call_signals_to_idx ON public.call_signals(to_user, created_at DESC);

DO $$ BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.call_signals; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.group_members; EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;

CREATE OR REPLACE FUNCTION public.create_group(p_name text, p_avatar text DEFAULT NULL, p_members uuid[] DEFAULT '{}')
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE gid uuid; uid uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  IF length(coalesce(p_name,'')) = 0 OR length(p_name) > 80 THEN RAISE EXCEPTION 'Invalid name'; END IF;
  INSERT INTO public.groups(name, avatar_url, owner_id) VALUES (p_name, p_avatar, auth.uid()) RETURNING id INTO gid;
  INSERT INTO public.group_members(group_id, user_id, role) VALUES (gid, auth.uid(), 'owner');
  FOREACH uid IN ARRAY p_members LOOP
    IF uid <> auth.uid() THEN
      INSERT INTO public.group_members(group_id, user_id, role) VALUES (gid, uid, 'member') ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;
  RETURN gid;
END $$;

CREATE OR REPLACE FUNCTION public.group_set_role(p_gid uuid, p_user uuid, p_role text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF (SELECT owner_id FROM public.groups WHERE id=p_gid) <> auth.uid() THEN RAISE EXCEPTION 'Only owner'; END IF;
  IF p_role NOT IN ('admin','member') THEN RAISE EXCEPTION 'Bad role'; END IF;
  UPDATE public.group_members SET role=p_role WHERE group_id=p_gid AND user_id=p_user AND role<>'owner';
END $$;

CREATE OR REPLACE FUNCTION public.group_remove_member(p_gid uuid, p_user uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE my_role text;
BEGIN
  my_role := public.group_role(p_gid, auth.uid());
  IF my_role IS NULL THEN RAISE EXCEPTION 'Not a member'; END IF;
  IF p_user = auth.uid() THEN
    DELETE FROM public.group_members WHERE group_id=p_gid AND user_id=p_user AND role<>'owner';
    RETURN;
  END IF;
  IF my_role NOT IN ('owner','admin') THEN RAISE EXCEPTION 'No permission'; END IF;
  DELETE FROM public.group_members WHERE group_id=p_gid AND user_id=p_user AND role<>'owner';
END $$;

CREATE OR REPLACE FUNCTION public.group_regen_invite(p_gid uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE tok text;
BEGIN
  IF (SELECT owner_id FROM public.groups WHERE id=p_gid) <> auth.uid()
     AND public.group_role(p_gid, auth.uid()) <> 'admin' THEN RAISE EXCEPTION 'No permission'; END IF;
  tok := encode(gen_random_bytes(12),'hex');
  UPDATE public.groups SET invite_token=tok, updated_at=now() WHERE id=p_gid;
  RETURN tok;
END $$;

CREATE OR REPLACE FUNCTION public.group_join_by_token(p_token text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE gid uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  SELECT id INTO gid FROM public.groups WHERE invite_token=p_token;
  IF gid IS NULL THEN RAISE EXCEPTION 'Invalid invite'; END IF;
  INSERT INTO public.group_members(group_id, user_id, role) VALUES (gid, auth.uid(), 'member') ON CONFLICT DO NOTHING;
  RETURN gid;
END $$;

CREATE OR REPLACE FUNCTION public.group_update_settings(p_gid uuid, p_name text DEFAULT NULL, p_avatar text DEFAULT NULL, p_lock_members boolean DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE my_role text;
BEGIN
  my_role := public.group_role(p_gid, auth.uid());
  IF my_role NOT IN ('owner','admin') THEN RAISE EXCEPTION 'No permission'; END IF;
  UPDATE public.groups SET
    name = COALESCE(p_name, name),
    avatar_url = COALESCE(p_avatar, avatar_url),
    lock_members_send = COALESCE(p_lock_members, lock_members_send),
    updated_at = now()
  WHERE id=p_gid;
END $$;

CREATE OR REPLACE FUNCTION public.my_groups()
RETURNS TABLE(id uuid, name text, avatar_url text, owner_id uuid, my_role text, member_count bigint, last_msg_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT g.id, g.name, g.avatar_url, g.owner_id, gm.role,
    (SELECT count(*) FROM public.group_members x WHERE x.group_id=g.id),
    (SELECT max(created_at) FROM public.messages m WHERE m.group_id=g.id AND NOT m.deleted_for_everyone)
  FROM public.groups g JOIN public.group_members gm ON gm.group_id=g.id
  WHERE gm.user_id = auth.uid()
  ORDER BY g.created_at DESC;
$$;

CREATE OR REPLACE FUNCTION public.group_members_list(p_gid uuid)
RETURNS TABLE(user_id uuid, username text, display_name text, avatar_url text, is_verified boolean, role text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT p.id, p.username, p.display_name, p.avatar_url, p.is_verified, gm.role
  FROM public.group_members gm JOIN public.profiles p ON p.id=gm.user_id
  WHERE gm.group_id = p_gid AND public.is_group_member(p_gid, auth.uid())
  ORDER BY CASE gm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, p.username;
$$;

CREATE OR REPLACE FUNCTION public.block_suspended_senders()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
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
    SELECT lock_members_send INTO grp FROM public.groups WHERE id = NEW.group_id;
    IF grp.lock_members_send AND public.group_role(NEW.group_id, NEW.sender_id) NOT IN ('owner','admin') THEN
      RAISE EXCEPTION 'ارسال در این گروه فقط برای ادمین‌هاست';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS messages_block_suspended ON public.messages;
CREATE TRIGGER messages_block_suspended BEFORE INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.block_suspended_senders();

CREATE OR REPLACE FUNCTION public.rate_app(p_stars int, p_comment text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  IF p_stars NOT BETWEEN 1 AND 5 THEN RAISE EXCEPTION 'Invalid stars'; END IF;
  INSERT INTO public.app_ratings(user_id, stars, comment)
  VALUES (auth.uid(), p_stars, p_comment)
  ON CONFLICT (user_id) DO UPDATE SET stars=EXCLUDED.stars, comment=EXCLUDED.comment, updated_at=now();
END $$;

CREATE OR REPLACE FUNCTION public.lookup_profile_by_username(p_username text)
RETURNS TABLE(id uuid, username text, display_name text, avatar_url text, is_verified boolean, is_scammer boolean, bio text, last_seen_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT id, username, display_name, avatar_url, is_verified, is_scammer, bio, last_seen_at
  FROM public.profiles WHERE LOWER(username) = LOWER(p_username) LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.admin_ratings_chart()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE result jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin'::public.app_role) THEN RAISE EXCEPTION 'Access denied'; END IF;
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM public.app_ratings),
    'average', (SELECT COALESCE(round(avg(stars)::numeric, 2), 0) FROM public.app_ratings),
    'breakdown', (SELECT jsonb_object_agg(s::text, c) FROM (
      SELECT s::int, COALESCE((SELECT count(*) FROM public.app_ratings WHERE stars=s),0) AS c
      FROM generate_series(1,5) s
    ) x),
    'recent', (SELECT COALESCE(jsonb_agg(jsonb_build_object('username',p.username,'stars',r.stars,'comment',r.comment,'created_at',r.created_at) ORDER BY r.created_at DESC), '[]'::jsonb)
               FROM public.app_ratings r JOIN public.profiles p ON p.id=r.user_id LIMIT 30)
  ) INTO result;
  RETURN result;
END $$;

GRANT EXECUTE ON FUNCTION public.create_group(text,text,uuid[]), public.group_set_role(uuid,uuid,text),
  public.group_remove_member(uuid,uuid), public.group_regen_invite(uuid), public.group_join_by_token(text),
  public.group_update_settings(uuid,text,text,boolean), public.my_groups(), public.group_members_list(uuid),
  public.rate_app(int,text), public.lookup_profile_by_username(text), public.admin_ratings_chart(),
  public.is_group_member(uuid,uuid), public.group_role(uuid,uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.block_suspended_senders() FROM PUBLIC, anon, authenticated;
