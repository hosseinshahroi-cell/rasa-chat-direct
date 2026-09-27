import { supabase } from "@/integrations/supabase/client";

/** Reads the signed-in user from the local session so it works offline. */
export async function getMe() {
  const { data } = await supabase.auth.getSession();
  return { data: { user: data.session?.user ?? null }, error: null };
}
