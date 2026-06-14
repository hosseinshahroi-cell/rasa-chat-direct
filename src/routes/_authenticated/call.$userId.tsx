import { createFileRoute, Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/UserAvatar";
import { Phone, PhoneOff, Mic, MicOff, Volume2, ArrowRight, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface CallSearch { incoming?: string }

export const Route = createFileRoute("/_authenticated/call/$userId")({
  head: () => ({ meta: [{ title: "تماس صوتی - رسا" }] }),
  validateSearch: (s: Record<string, unknown>): CallSearch => ({ incoming: s.incoming ? String(s.incoming) : undefined }),
  component: CallView,
});

const ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

function CallView() {
  const { userId: peerId } = Route.useParams();
  const { incoming } = useSearch({ from: "/_authenticated/call/$userId" });
  const navigate = useNavigate();
  const [me, setMe] = useState<string | null>(null);
  const [peer, setPeer] = useState<{ username: string; display_name: string | null; avatar_url: string | null } | null>(null);
  const [status, setStatus] = useState<"init" | "calling" | "ringing" | "connected" | "ended">("init");
  const [muted, setMuted] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);
  const callIdRef = useRef<string>(incoming || crypto.randomUUID());
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const isCallerRef = useRef<boolean>(!incoming);
  const iceQueueRef = useRef<RTCIceCandidateInit[]>([]);

  // load me + peer
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setMe(data.user?.id ?? null));
    supabase.from("profiles").select("username, display_name, avatar_url").eq("id", peerId).maybeSingle()
      .then(({ data }) => setPeer(data));
  }, [peerId]);

  // timer
  useEffect(() => {
    if (status !== "connected") return;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [status]);

  // main signaling + WebRTC setup
  useEffect(() => {
    if (!me) return;
    let cancelled = false;

    const sendSignal = async (kind: string, payload: unknown) => {
      await supabase.from("call_signals").insert({
        from_user: me, to_user: peerId, call_id: callIdRef.current, kind,
        payload: payload as never,
      });
    };

    const cleanupSignals = async () => {
      await supabase.from("call_signals").delete().eq("call_id", callIdRef.current);
    };

    (async () => {
      // 1) Get mic
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        toast.error("دسترسی به میکروفون داده نشد");
        navigate({ to: "/chats/$userId", params: { userId: peerId } });
        return;
      }
      if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
      localStreamRef.current = stream;

      // 2) PeerConnection
      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      pcRef.current = pc;
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));

      pc.onicecandidate = (e) => { if (e.candidate) sendSignal("ice", e.candidate.toJSON()); };
      pc.ontrack = (e) => {
        if (remoteAudioRef.current) {
          remoteAudioRef.current.srcObject = e.streams[0];
          remoteAudioRef.current.play().catch(() => {});
        }
      };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "connected") setStatus("connected");
        else if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
          setStatus("ended");
        }
      };

      const addQueuedIce = async () => {
        const queued = [...iceQueueRef.current];
        iceQueueRef.current = [];
        for (const candidate of queued) await pc.addIceCandidate(new RTCIceCandidate(candidate));
      };

      // 3) Signaling channel
      let started = false;
      const ch = supabase
        .channel(`call-${callIdRef.current}`)
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "call_signals", filter: `call_id=eq.${callIdRef.current}` },
          async (payload) => {
            const sig = payload.new as { kind: string; from_user: string; payload: unknown };
            if (sig.from_user === me) return;
            try {
              if (sig.kind === "offer" && !isCallerRef.current) {
                await pc.setRemoteDescription(new RTCSessionDescription(sig.payload as RTCSessionDescriptionInit));
                await addQueuedIce();
                const answer = await pc.createAnswer();
                await pc.setLocalDescription(answer);
                await sendSignal("answer", answer);
              } else if (sig.kind === "answer" && isCallerRef.current) {
                await pc.setRemoteDescription(new RTCSessionDescription(sig.payload as RTCSessionDescriptionInit));
                await addQueuedIce();
              } else if (sig.kind === "ice") {
                const candidate = sig.payload as RTCIceCandidateInit;
                if (pc.remoteDescription) await pc.addIceCandidate(new RTCIceCandidate(candidate));
                else iceQueueRef.current.push(candidate);
              } else if (sig.kind === "hangup") {
                setStatus("ended");
              }
            } catch (e) { console.error("signal err", e); }
          }
        )
        .subscribe(async (subStatus) => {
          if (subStatus !== "SUBSCRIBED" || started || cancelled) return;
          started = true;
          if (isCallerRef.current) {
            setStatus("calling");
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            await sendSignal("offer", offer);
          } else {
            setStatus("ringing");
            const { data: existing } = await supabase
              .from("call_signals").select("kind, payload, from_user")
              .eq("call_id", callIdRef.current).eq("kind", "offer").maybeSingle();
            if (existing && existing.from_user !== me) {
              await pc.setRemoteDescription(new RTCSessionDescription(existing.payload as unknown as RTCSessionDescriptionInit));
              await addQueuedIce();
              const answer = await pc.createAnswer();
              await pc.setLocalDescription(answer);
              await sendSignal("answer", answer);
            }
          }
        });
      channelRef.current = ch;
    })();

    return () => {
      cancelled = true;
      try { pcRef.current?.getSenders().forEach((s) => s.track?.stop()); } catch { /* noop */ }
      pcRef.current?.close();
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      if (channelRef.current) supabase.removeChannel(channelRef.current);
      sendSignal("hangup", {}).catch(() => {});
      cleanupSignals().catch(() => {});
    };
  }, [me, peerId, navigate]);

  const toggleMute = () => {
    const tracks = localStreamRef.current?.getAudioTracks() || [];
    const next = !muted;
    tracks.forEach((t) => (t.enabled = !next));
    setMuted(next);
  };

  const hangup = () => {
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
        <audio ref={remoteAudioRef} autoPlay />
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
