import { createFileRoute, Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/UserAvatar";
import { PhoneOff, Mic, MicOff, Volume2, ArrowRight, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { getAgoraToken } from "@/lib/agora.functions";
import AgoraRTC, {
  type IAgoraRTCClient,
  type IMicrophoneAudioTrack,
  type IAgoraRTCRemoteUser,
} from "agora-rtc-sdk-ng";

interface CallSearch { incoming?: string }

export const Route = createFileRoute("/_authenticated/call/$userId")({
  head: () => ({ meta: [{ title: "تماس صوتی - رسا" }] }),
  validateSearch: (s: Record<string, unknown>): CallSearch => ({ incoming: s.incoming ? String(s.incoming) : undefined }),
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

function CallView() {
  const { userId: peerId } = Route.useParams();
  const { incoming } = useSearch({ from: "/_authenticated/call/$userId" });
  const navigate = useNavigate();
  const fetchToken = useServerFn(getAgoraToken);
  const [me, setMe] = useState<string | null>(null);
  const [peer, setPeer] = useState<{ username: string; display_name: string | null; avatar_url: string | null } | null>(null);
  const [status, setStatus] = useState<"init" | "calling" | "ringing" | "connected" | "ended">("init");
  const [muted, setMuted] = useState(false);
  const [seconds, setSeconds] = useState(0);

  const clientRef = useRef<IAgoraRTCClient | null>(null);
  const micRef = useRef<IMicrophoneAudioTrack | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const callIdRef = useRef<string>(incoming || crypto.randomUUID());
  const isCallerRef = useRef<boolean>(!incoming);
  const endedRef = useRef(false);
  const secondsRef = useRef(0);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setMe(data.user?.id ?? null));
    supabase.from("profiles").select("username, display_name, avatar_url").eq("id", peerId).maybeSingle()
      .then(({ data }) => setPeer(data));
  }, [peerId]);

  useEffect(() => {
    if (status !== "connected") return;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [status]);

  useEffect(() => {
    if (!me) return;
    let cancelled = false;

    const sendSignal = async (kind: string, payload: Record<string, unknown> = {}) => {
      await supabase.from("call_signals").insert({
        from_user: me, to_user: peerId, call_id: callIdRef.current, kind,
        payload: payload as never,
      });
    };

    const sendSystemMessage = async (content: string) => {
      if (!isCallerRef.current || !me) return;
      await supabase.from("messages").insert({
        sender_id: me, receiver_id: peerId, content,
      });
    };

    const joinAgora = async () => {
      if (cancelled) return;
      try {
        const uid = uuidToUid(me);
        const channel = callIdRef.current;
        const { appId, token } = await fetchToken({ data: { channel, uid } });
        const client = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });
        clientRef.current = client;
        client.on("user-published", async (user: IAgoraRTCRemoteUser, mediaType) => {
          await client.subscribe(user, mediaType);
          if (mediaType === "audio") user.audioTrack?.play();
          setStatus("connected");
        });
        client.on("user-unpublished", () => { /* peer muted */ });
        client.on("user-left", () => {
          if (!endedRef.current) { endedRef.current = true; setStatus("ended"); }
        });
        client.on("connection-state-change", (cur) => {
          if (cur === "DISCONNECTED" && !endedRef.current) { endedRef.current = true; setStatus("ended"); }
        });
        await client.join(appId, channel, token, uid);
        const mic = await AgoraRTC.createMicrophoneAudioTrack({
          encoderConfig: "music_standard",
          AEC: true,
          ANS: true,
          AGC: true,
        });
        micRef.current = mic;
        await client.publish([mic]);
        if (client.remoteUsers.length > 0) setStatus("connected");
      } catch (err) {
        console.error("agora join error", err);
        toast.error("خطا در برقراری تماس صوتی");
        if (!endedRef.current) { endedRef.current = true; setStatus("ended"); }
      }
    };

    (async () => {
      // check mic permission upfront (nice error)
      try {
        const s = await navigator.mediaDevices.getUserMedia({ audio: true });
        s.getTracks().forEach((t) => t.stop());
      } catch {
        toast.error("دسترسی به میکروفون داده نشد");
        navigate({ to: "/chats/$userId", params: { userId: peerId } });
        return;
      }

      // set up signaling channel for offer/answer/hangup
      const ch = supabase
        .channel(`call-${callIdRef.current}-${me}`)
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "call_signals", filter: `call_id=eq.${callIdRef.current}` },
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
            setStatus("calling");
            await sendSignal("offer", { channel: callIdRef.current });
            await sendSystemMessage("📞 تماس صوتی شروع شد");
          } else {
            setStatus("ringing");
            await sendSignal("answer", { channel: callIdRef.current });
          }
          await joinAgora();
        });
      channelRef.current = ch;
    })();

    return () => {
      cancelled = true;
      const durationSec = secondsRef.current;
      (async () => {
        try {
          if (micRef.current) {
            micRef.current.stop();
            micRef.current.close();
            micRef.current = null;
          }
          if (clientRef.current) {
            await clientRef.current.leave();
            clientRef.current.removeAllListeners();
            clientRef.current = null;
          }
        } catch { /* noop */ }
        if (channelRef.current) supabase.removeChannel(channelRef.current);
        try { await sendSignal("hangup"); } catch { /* noop */ }
        if (isCallerRef.current) {
          const m = Math.floor(durationSec / 60);
          const s = durationSec % 60;
          const label = durationSec > 0
            ? `📞 تماس صوتی پایان یافت • مدت ${m}:${String(s).padStart(2, "0")}`
            : "📞 تماس صوتی بدون پاسخ";
          try { await sendSystemMessage(label); } catch { /* noop */ }
        }
      })();
    };
  }, [me, peerId, navigate, fetchToken]);

  const toggleMute = () => {
    const next = !muted;
    micRef.current?.setEnabled(!next);
    setMuted(next);
  };

  const hangup = () => {
    endedRef.current = true;
    setStatus("ended");
    setTimeout(() => navigate({ to: "/chats/$userId", params: { userId: peerId } }), 300);
  };

  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  return (
    <div className="min-h-screen bg-gradient-to-b from-primary/20 via-background to-background flex flex-col">
      <header className="px-3 py-2.5 flex items-center gap-2">
        <Link to="/chats/$userId" params={{ userId: peerId }}>
          <Button size="icon" variant="ghost"><ArrowRight className="w-5 h-5" /></Button>
        </Link>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center gap-6 px-6">
        <div className="relative">
          <div className="absolute inset-0 rounded-full bg-primary/30 animate-ping" style={{ animationDuration: status === "connected" ? "0s" : "2s" }} />
          <UserAvatar avatarPath={peer?.avatar_url ?? null} name={peer?.display_name || peer?.username || "..."} className="w-32 h-32 relative" />
        </div>
        <div className="text-center">
          <h2 className="text-2xl font-bold">{peer?.display_name || peer?.username || "..."}</h2>
          <p className="text-sm text-muted-foreground mt-1">
            {status === "calling" && "در حال تماس..."}
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
      </main>

      <footer className="pb-10 pt-4 flex items-center justify-center gap-6">
        <Button onClick={toggleMute} variant={muted ? "destructive" : "secondary"} size="lg" className="rounded-full w-14 h-14 p-0">
          {muted ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
        </Button>
        <Button onClick={hangup} variant="destructive" size="lg" className="rounded-full w-16 h-16 p-0">
          <PhoneOff className="w-7 h-7" />
        </Button>
      </footer>
    </div>
  );
}
