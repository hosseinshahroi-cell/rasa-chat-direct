import agoraToken from "agora-token";

const { RtcTokenBuilder, RtcRole } = agoraToken;

export function buildAgoraToken(channel: string, uid: number) {
  const appId = process.env.AGORA_APP_ID;
  const appCert = process.env.AGORA_APP_CERTIFICATE;
  if (!appId || !appCert) throw new Error("Agora keys not configured");
  const expireSec = 3600;
  const privExpire = Math.floor(Date.now() / 1000) + expireSec;
  const token = RtcTokenBuilder.buildTokenWithUid(
    appId, appCert, channel, uid, RtcRole.PUBLISHER, privExpire, privExpire,
  );
  return { appId, token, uid, channel, expiresAt: privExpire };
}
