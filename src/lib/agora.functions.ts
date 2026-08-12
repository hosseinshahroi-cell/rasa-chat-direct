import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { buildAgoraToken } from "@/lib/agora.server";

export const getAgoraToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { channel: string; uid: number }) => {
    if (!data || typeof data.channel !== "string" || data.channel.length === 0 || data.channel.length > 64) {
      throw new Error("Invalid channel");
    }
    if (typeof data.uid !== "number" || !Number.isInteger(data.uid) || data.uid < 1) {
      throw new Error("Invalid uid");
    }
    return data;
  })
  .handler(async ({ data }) => buildAgoraToken(data.channel, data.uid));
