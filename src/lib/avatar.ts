import { supabase } from "@/integrations/supabase/client";

const cache = new Map<string, string>();

export async function getAvatarUrl(path: string | null | undefined): Promise<string | null> {
  if (!path) return null;
  if (path.startsWith("http")) return path;
  if (cache.has(path)) return cache.get(path)!;
  const { data } = await supabase.storage.from("avatars").createSignedUrl(path, 60 * 60);
  if (data?.signedUrl) {
    cache.set(path, data.signedUrl);
    return data.signedUrl;
  }
  return null;
}
