ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS media_group_id uuid;
CREATE INDEX IF NOT EXISTS messages_media_group_id_idx ON public.messages (media_group_id) WHERE media_group_id IS NOT NULL;