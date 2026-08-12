import { createFileRoute, Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/UserAvatar";
import {
  PhoneOff, Mic, MicOff, Volume2, ArrowRight, Loader2,
  Video, VideoOff, SwitchCamera,
} from "lucide-react";
import { toast } from "sonner";
import { getAgoraToken } from "@/lib/agora.functions";
import AgoraRTC, {
  type IAgoraRTCClient,
  type IMicrophoneAudioTrack,
  type ICameraVideoTrack,
  type IAgoraRTCRemoteUser,
  type IRemoteVideoTrack,
} from "agora-rtc-sdk-ng";
import {
  acquireSession, releaseSession, createProcessedMic, playRemoteAudio, stopRemoteAudio, getSession,
} from "@/lib/agora-session";

interface CallSearch { incoming?: string; video?: string }

export const Route = createFileRoute("/_authenticated/call/$userId")({
  head: () => ({ meta: [{ title: "تماس - رسا" }] }),
  validateSearch: (s: Record<string, unknown>): CallSearch => ({
    incoming: s.incoming ? String(s.incoming) : undefined,
    video: s.video ? String(s.video) : undefined,
  }),
  component: CallView,
});

// stable int uid from uuid (1 .. 2^31-1)
function uuidToUid(uuid: string): number {
  let h = 2166136261;
  for (let i = 0; i < uuid.length; i++) {
    h ^= uuid.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return (h % 2147483646) + 1;
}

/** waits until the container is actually laid out, then plays the track into it */
async function playInto(
  getEl: () => HTMLDivElement | null,
  track: IRemoteVideoTrack | ICameraVideoTrack | undefined | null,
  opts: { mirror?: boolean },
) {
  if (!track) return;
  for (let i = 0; i < 40; i++) {
    const el = getEl();
    if (el && el.clientWidth > 0 && el.clientHeight > 0) {
      try { track.play(el, { fit: "contain", mirror: opts.mirror }); } catch { /* noop */ }
      return;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
}

function CallView() {
  const { userId: peerId } = Route.useParams();
  const { incoming, video } = useSearch({ from: "/_authenticated/call/$userId" });
  const isVideoCall = video === "1";
  const navigate = useNavigate();
  const fetchToken = useServerFn(getAgoraToken);
  const [me, setMe] = useState<string | null>(null);
  const [peer, setPeer] = useState<{ username: string; display_name: string | null; avatar_url: string | null } | null>(null);
  const [status, setStatus] = useState<"init" | "calling" | "ringing" | "connected" | "ended">("init");
  const [muted, setMuted] = useState(false);
  const [camOn, setCamOn] = useState(isVideoCall);
  const [remoteVideoOn, setRemoteVideoOn] = useState(false);
  const [seconds, setSeconds] = useState(0);

  const clientRef = useRef<IAgoraRTCClient | null>(null);
  const micRef = useRef<IMicrophoneAudioTrack | null>(null);
  const camRef = useRef<ICameraVideoTrack | null>(null);
  const localVideoRef = useRef<HTMLDivElement | null>(null);
  const remoteVideoRef = useRef<HTMLDivElement | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const callIdRef = useRef<string>(incoming || crypto.randomUUID());
  const isCallerRef = useRef<boolean>(!incoming);
  const endedRef = useRef(false);
  /** true only when THIS user pressed hangup / navigated away intentionally */
  const userEndedRef = useRef(false);
  const secondsRef = useRef(0);
  const facingRef = useRef<"user" | "environment">("user");
  const fetchTokenRef = useRef(fetchToken);
  fetchTokenRef.current = fetchToken;
  const isVideoRef = useRef(isVideoCall);
  isVideoRef.current = isVideoCall;
  const peerIdRef = useRef(peerId);
  peerIdRef.current = peerId;
  const disconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setMe(data.user?.id ?? null));
    supabase.from("profiles").select("username, display_name, avatar_url").eq("id", peerId).maybeSingle()
      .then(({ data }) => setPeer(data));
  }, [peerId]);

  useEffect(() => {
    if (status !== "connected") return;
    const t = setInterval(() => setSeconds((s) => { const n = s + 1; secondsRef.current = n; return n; }), 1000);
    return () => clearInterval(t);
  }, [status]);

  useEffect(() => {
    if (!me) return;
    let cancelled = false;
    const callId = callIdRef.current;

    const sendSignal = async (kind: string, payload: Record<string, unknown> = {}) => {
      await supabase.from("call_signals").insert({
        from_user: me, to_user: peerIdRef.current, call_id: callId, kind,
        payload: payload as never,
      });
    };

    const sendSystemMessage = async (content: string) => {
      if (!isCallerRef.current) return;
      await supabase.from("messages").insert({
        sender_id: me, receiver_id: peerIdRef.current, content,
      });
    };

    const joinAgora = async () => {
      try {
        const uid = uuidToUid(me);
        // single serialized session per channel – never two clients at once
        const session = await acquireSession(callId);
        if (cancelled) return;
        const client = session.client;
        clientRef.current = client;

        const attachExisting = async () => {
          for (const u of client.remoteUsers) {
            if (u.hasAudio) {
              try {
                await client.subscribe(u, "audio");
                playRemoteAudio(session, `${u.uid}`, u.audioTrack);
              } catch { /* noop */ }
            }
            if (u.hasVideo) {
              try {
                await client.subscribe(u, "video");
                setRemoteVideoOn(true);
                void playInto(() => remoteVideoRef.current, u.videoTrack, {});
              } catch { /* noop */ }
            }
          }
          if (client.remoteUsers.length > 0) setStatus("connected");
        };

        if (session.joined) {
          micRef.current = session.mic;
          camRef.current = session.cam;
          if (session.cam) void playInto(() => localVideoRef.current, session.cam, { mirror: true });
          await attachExisting();
          setStatus((s) => (client.remoteUsers.length > 0 ? "connected" : s));
          return;
        }

        const wantVideo = isVideoRef.current;
        const [tokenRes, mic, cam] = await Promise.all([
          fetchTokenRef.current({ data: { channel: callId, uid } }),
          session.mic ? Promise.resolve(session.mic) : createProcessedMic(),
          wantVideo && !session.cam
            ? AgoraRTC.createCameraVideoTrack({ encoderConfig: "480p_1", facingMode: facingRef.current })
                .catch(() => null)
            : Promise.resolve(session.cam),
        ]);
        if (cancelled) return;
        session.mic = mic;
        micRef.current = mic;
        if (cam) { session.cam = cam; camRef.current = cam; }
        setCamOn(!!cam);
        if (wantVideo && !cam) toast.error("دسترسی به دوربین داده نشد");
        const { appId, token } = tokenRes;

        client.removeAllListeners();
        client.on("user-published", async (user: IAgoraRTCRemoteUser, mediaType) => {
          try { await client.subscribe(user, mediaType); } catch { return; }
          if (mediaType === "audio") playRemoteAudio(session, `${user.uid}`, user.audioTrack);
          if (mediaType === "video") {
            setRemoteVideoOn(true);
            void playInto(() => remoteVideoRef.current, user.videoTrack, {});
          }
          setStatus("connected");
        });
        client.on("user-unpublished", (u, mediaType) => {
          if (mediaType === "video") setRemoteVideoOn(false);
          if (mediaType === "audio") stopRemoteAudio(session, `${u.uid}`);
        });
        client.on("user-joined", () => setStatus("connected"));
        client.on("user-left", (u, reason) => {
          stopRemoteAudio(session, `${u.uid}`);
          setRemoteVideoOn(false);
          // ignore transient drops – only a real leave/ban ends the call
          if (reason === "Quit" || reason === "ServerTimeOut") {
            if (!endedRef.current) { endedRef.current = true; setStatus("ended"); }
          }
        });
        client.on("connection-state-change", (cur) => {
          if (disconnectTimerRef.current) { clearTimeout(disconnectTimerRef.current); disconnectTimerRef.current = null; }
          if (cur === "DISCONNECTED") {
            // give the SDK a grace period to reconnect before ending
            disconnectTimerRef.current = setTimeout(() => {
              if (client.connectionState === "DISCONNECTED" && !endedRef.current && !cancelled) {
                endedRef.current = true; setStatus("ended");
              }
            }, 6000);
          }
        });
        const renew = async () => {
          try {
            const fresh = await fetchTokenRef.current({ data: { channel: callId, uid } });
            await client.renewToken(fresh.token);
          } catch { /* noop */ }
        };
        client.on("token-privilege-will-expire", renew);
        client.on("token-privilege-did-expire", renew);

        await client.join(appId, callId, token, uid);
        session.joined = true;
        if (cancelled) return;
        await client.publish(cam ? [mic, cam] : [mic]);
        if (cam) void playInto(() => localVideoRef.current, cam, { mirror: true });
        await attachExisting();
      } catch (err) {
        console.error("agora join error", err);
        const msg = err instanceof Error ? err.message : String(err);
        toast.error(`خطا در تماس: ${msg}`);
        if (!endedRef.current) { endedRef.current = true; setStatus("ended"); }
      }
    };

    (async () => {
      setStatus(isCallerRef.current ? "calling" : "ringing");
      const joining = joinAgora();

      const ch = supabase
        .channel(`call-${callId}-${me}`)
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "call_signals", filter: `call_id=eq.${callId}` },
          (payload) => {
            const sig = payload.new as { kind: string; from_user: string };
            if (sig.from_user === me) return;
            if (sig.kind === "answer" && isCallerRef.current) {
              setStatus((s) => s === "calling" ? "ringing" : s);
            } else if (sig.kind === "hangup" || sig.kind === "reject") {
              if (!endedRef.current) { endedRef.current = true; setStatus("ended"); }
            }
          }
        )
        .subscribe(async (subStatus) => {
          if (subStatus !== "SUBSCRIBED" || cancelled) return;
          if (isCallerRef.current) {
            await sendSignal("offer", { channel: callId, video: isVideoRef.current });
            await sendSystemMessage(isVideoRef.current ? "🎥 تماس تصویری شروع شد" : "📞 تماس صوتی شروع شد");
          } else {
            await sendSignal("answer", { channel: callId });
          }
        });
      channelRef.current = ch;
      await joining;
    })();


    return () => {
      cancelled = true;
      const durationSec = secondsRef.current;
      const wasVideo = isVideoRef.current;
      const userEnded = userEndedRef.current;
      if (disconnectTimerRef.current) { clearTimeout(disconnectTimerRef.current); disconnectTimerRef.current = null; }
      (async () => {
        micRef.current = null;
        camRef.current = null;
        clientRef.current = null;
        await releaseSession(callId);

        if (channelRef.current) { supabase.removeChannel(channelRef.current); channelRef.current = null; }
        // only tell the peer we hung up when the user actually ended the call,
        // never on a React re-mount / effect re-run
        if (!userEnded) return;
        try { await sendSignal("hangup"); } catch { /* noop */ }
        if (isCallerRef.current) {
          const m = Math.floor(durationSec / 60);
          const s = durationSec % 60;
          const kind = wasVideo ? "🎥 تماس تصویری" : "📞 تماس صوتی";
          const label = durationSec > 0
            ? `${kind} پایان یافت • مدت ${m}:${String(s).padStart(2, "0")}`
            : `${kind} بدون پاسخ`;
          try { await sendSystemMessage(label); } catch { /* noop */ }
        }
      })();
    };
  }, [me]);


  const toggleMute = () => {
    const next = !muted;
    micRef.current?.setEnabled(!next);
    setMuted(next);
  };

  const toggleCam = async () => {
    const client = clientRef.current;
    if (!client) return;
    if (camRef.current) {
      const next = !camOn;
      await camRef.current.setEnabled(next);
      setCamOn(next);
      if (next) void playInto(() => localVideoRef.current, camRef.current, { mirror: true });
      return;
    }
    try {
      const cam = await AgoraRTC.createCameraVideoTrack({
        encoderConfig: "480p_1",
        facingMode: facingRef.current,
      });
      camRef.current = cam;
      const s = getSession();
      if (s) s.cam = cam;
      await client.publish([cam]);
      setCamOn(true);
      void playInto(() => localVideoRef.current, cam, { mirror: true });
    } catch {
      toast.error("دسترسی به دوربین داده نشد");
    }
  };

  const switchCamera = async () => {
    const cam = camRef.current;
    if (!cam) return;
    try {
      const cams = await AgoraRTC.getCameras();
      if (cams.length < 2) { toast("دوربین دیگری یافت نشد"); return; }
      const current = cam.getMediaStreamTrack().getSettings().deviceId;
      const next = cams.find((c) => c.deviceId !== current) ?? cams[0];
      await cam.setDevice(next.deviceId);
      facingRef.current = facingRef.current === "user" ? "environment" : "user";
    } catch {
      toast.error("تعویض دوربین ممکن نشد");
    }
  };

  const hangup = () => {
    userEndedRef.current = true;
    endedRef.current = true;
    setStatus("ended");
    setTimeout(() => navigate({ to: "/chats/$userId", params: { userId: peerId } }), 300);
  };

  // browsers can block autoplay of the remote audio – retry on first interaction
  useEffect(() => {
    const retry = () => {
      const s = getSession();
      if (!s) return;
      for (const t of s.remoteAudio.values()) {
        try { t.play(); } catch { /* noop */ }
      }
    };
    window.addEventListener("pointerdown", retry);
    window.addEventListener("touchstart", retry);
    return () => {
      window.removeEventListener("pointerdown", retry);
      window.removeEventListener("touchstart", retry);
    };
  }, []);

  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  const showRemoteVideo = isVideoCall && remoteVideoOn;

  return (
    <div className="min-h-screen bg-gradient-to-b from-primary/20 via-background to-background flex flex-col relative overflow-hidden">
      {/* remote video always mounted & laid out so play() has a real container */}
      <div ref={remoteVideoRef} className="absolute inset-0 bg-black z-0" />
      {!showRemoteVideo && <div className="absolute inset-0 bg-background z-0" />}

      <header className="px-3 py-2.5 flex items-center gap-2 relative z-10">
        <Link to="/chats/$userId" params={{ userId: peerId }}>
          <Button size="icon" variant="ghost" onClick={() => { userEndedRef.current = true; }}>
            <ArrowRight className="w-5 h-5" />
          </Button>
        </Link>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center gap-6 px-6 relative z-10 pointer-events-none">
        {!showRemoteVideo && (
          <>
            <div className="relative">
              <div className="absolute inset-0 rounded-full bg-primary/30 animate-ping" style={{ animationDuration: status === "connected" ? "0s" : "2s" }} />
              <UserAvatar avatarPath={peer?.avatar_url ?? null} name={peer?.display_name || peer?.username || "..."} className="w-32 h-32 relative" />
            </div>
            <div className="text-center">
              <h2 className="text-2xl font-bold">{peer?.display_name || peer?.username || "..."}</h2>
              <p className="text-sm text-muted-foreground mt-1">
                {status === "calling" && (isVideoCall ? "در حال تماس تصویری..." : "در حال تماس...")}
                {status === "ringing" && "در حال اتصال..."}
                {status === "connected" && (
                  <span className="flex items-center justify-center gap-1.5 text-primary">
                    <Volume2 className="w-4 h-4" /> {fmt(seconds)}
                  </span>
                )}
                {status === "ended" && "تماس پایان یافت"}
                {status === "init" && <Loader2 className="w-4 h-4 animate-spin inline" />}
              </p>
            </div>
          </>
        )}
        {showRemoteVideo && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 rounded-full bg-black/50 px-3 py-1 text-xs text-white">
            {peer?.display_name || peer?.username} • {fmt(seconds)}
          </div>
        )}
      </main>

      {/* local preview – always laid out, only visually hidden */}
      <div
        ref={localVideoRef}
        className={`absolute top-16 left-3 w-28 h-44 rounded-2xl overflow-hidden bg-black/60 border border-white/20 z-20 ${
          isVideoCall && camOn ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
      />

      <footer className="pb-10 pt-4 flex items-center justify-center gap-4 relative z-10">
        <Button onClick={toggleMute} variant={muted ? "destructive" : "secondary"} size="lg" className="rounded-full w-14 h-14 p-0">
          {muted ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
        </Button>
        <Button onClick={toggleCam} variant={camOn ? "secondary" : "outline"} size="lg" className="rounded-full w-14 h-14 p-0" title="دوربین">
          {camOn ? <Video className="w-6 h-6" /> : <VideoOff className="w-6 h-6" />}
        </Button>
        {camOn && (
          <Button onClick={switchCamera} variant="secondary" size="lg" className="rounded-full w-14 h-14 p-0" title="تعویض دوربین">
            <SwitchCamera className="w-6 h-6" />
          </Button>
        )}
        <Button onClick={hangup} variant="destructive" size="lg" className="rounded-full w-16 h-16 p-0">
          <PhoneOff className="w-7 h-7" />
        </Button>
      </footer>
    </div>
  );
}
