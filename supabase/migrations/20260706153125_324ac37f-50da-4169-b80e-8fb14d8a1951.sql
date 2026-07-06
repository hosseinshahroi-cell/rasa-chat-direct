
CREATE TABLE IF NOT EXISTS public.story_likes (
  story_id uuid NOT NULL REFERENCES public.stories(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (story_id, user_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.story_likes TO authenticated;
GRANT ALL ON public.story_likes TO service_role;
ALTER TABLE public.story_likes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can like active stories" ON public.story_likes;
CREATE POLICY "Users can like active stories" ON public.story_likes
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND EXISTS (SELECT 1 FROM public.stories s WHERE s.id = story_id AND s.expires_at > now()));

DROP POLICY IF EXISTS "Users can unlike own like" ON public.story_likes;
CREATE POLICY "Users can unlike own like" ON public.story_likes
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "View likes on own stories or own likes" ON public.story_likes;
CREATE POLICY "View likes on own stories or own likes" ON public.story_likes
  FOR SELECT TO authenticated USING (
    user_id = auth.uid() OR EXISTS (SELECT 1 FROM public.stories s WHERE s.id = story_id AND s.user_id = auth.uid())
  );

CREATE OR REPLACE FUNCTION public.toggle_story_like(p_story uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  IF EXISTS (SELECT 1 FROM public.story_likes WHERE story_id = p_story AND user_id = auth.uid()) THEN
    DELETE FROM public.story_likes WHERE story_id = p_story AND user_id = auth.uid();
    RETURN false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.stories WHERE id = p_story AND expires_at > now()) THEN RAISE EXCEPTION 'Story expired'; END IF;
  INSERT INTO public.story_likes(story_id, user_id) VALUES (p_story, auth.uid());
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.story_viewers(p_story uuid)
RETURNS TABLE (user_id uuid, username text, display_name text, avatar_url text, viewed_at timestamptz, liked boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id, p.username, p.display_name, p.avatar_url, v.viewed_at,
    EXISTS(SELECT 1 FROM public.story_likes l WHERE l.story_id = v.story_id AND l.user_id = v.viewer_id) AS liked
  FROM public.story_views v
  JOIN public.profiles p ON p.id = v.viewer_id
  WHERE v.story_id = p_story
    AND EXISTS (SELECT 1 FROM public.stories s WHERE s.id = p_story AND s.user_id = auth.uid())
  ORDER BY v.viewed_at DESC;
$$;

DROP FUNCTION IF EXISTS public.active_stories();
CREATE OR REPLACE FUNCTION public.active_stories()
RETURNS TABLE(id uuid, user_id uuid, username text, display_name text, avatar_url text, media_url text, media_type text, caption text, created_at timestamptz, expires_at timestamptz, view_count bigint, like_count bigint, viewed_by_me boolean, liked_by_me boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.id, s.user_id, p.username, p.display_name, p.avatar_url, s.media_url, s.media_type, s.caption, s.created_at, s.expires_at,
    (SELECT count(*) FROM public.story_views v WHERE v.story_id=s.id),
    (SELECT count(*) FROM public.story_likes l WHERE l.story_id=s.id),
    EXISTS(SELECT 1 FROM public.story_views v WHERE v.story_id=s.id AND v.viewer_id=auth.uid()),
    EXISTS(SELECT 1 FROM public.story_likes l WHERE l.story_id=s.id AND l.user_id=auth.uid())
  FROM public.stories s JOIN public.profiles p ON p.id=s.user_id
  WHERE s.expires_at > now()
  ORDER BY s.created_at DESC;
$$;
