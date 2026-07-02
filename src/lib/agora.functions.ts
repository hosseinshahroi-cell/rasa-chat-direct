import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { RtcTokenBuilder, RtcRole } from "agora-token";

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
  .handler(async ({ data }) => {
    const appId = process.env.AGORA_APP_ID;
    const appCert = process.env.AGORA_APP_CERTIFICATE;
    if (!appId || !appCert) throw new Error("Agora keys not configured");
    const expireSec = 3600;
    const now = Math.floor(Date.now() / 1000);
    const privExpire = now + expireSec;
    const token = RtcTokenBuilder.buildTokenWithUid(
      appId, appCert, data.channel, data.uid, RtcRole.PUBLISHER, privExpire, privExpire,
    );
    return { appId, token, uid: data.uid, channel: data.channel, expiresAt: privExpire };
  });
