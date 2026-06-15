import { createFileRoute, Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/UserAvatar";
import { Phone, PhoneOff, Mic, MicOff, Volume2, ArrowRight, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface CallSearch { incoming?: string }
interface CallSignalRow { id?: string; kind: string; from_user: string; payload: unknown; created_at?: string }

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
  const processedSignalsRef = useRef<Set<string>>(new Set());
  const drainTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS, iceCandidatePoolSize: 10 });
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
        else if (pc.connectionState === "failed" || pc.connectionState === "closed") setStatus("ended");
      };
      pc.oniceconnectionstatechange = () => {
        if (pc.iceConnectionState === "connected" || pc.iceConnectionState === "completed") setStatus("connected");
        if (pc.iceConnectionState === "failed") setStatus("ended");
      };

      const addQueuedIce = async () => {
        if (!pc.remoteDescription) return;
        const queued = [...iceQueueRef.current];
        iceQueueRef.current = [];
        for (const candidate of queued) {
          try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); }
          catch (err) { console.warn("queued ice failed", err); }
        }
      };

      const processSignal = async (sig: CallSignalRow) => {
        const key = sig.id || `${sig.kind}-${sig.from_user}-${sig.created_at || ""}`;
        if (processedSignalsRef.current.has(key)) return;
        processedSignalsRef.current.add(key);
        if (sig.from_user === me) return;
        try {
          if (sig.kind === "offer" && !isCallerRef.current) {
            if (!pc.remoteDescription) {
              await pc.setRemoteDescription(new RTCSessionDescription(sig.payload as RTCSessionDescriptionInit));
              await addQueuedIce();
              const answer = await pc.createAnswer();
              await pc.setLocalDescription(answer);
              await sendSignal("answer", answer);
            }
          } else if (sig.kind === "answer" && isCallerRef.current) {
            if (!pc.remoteDescription) {
              await pc.setRemoteDescription(new RTCSessionDescription(sig.payload as RTCSessionDescriptionInit));
              await addQueuedIce();
            }
          } else if (sig.kind === "ice") {
            const candidate = sig.payload as RTCIceCandidateInit;
            if (pc.remoteDescription) await pc.addIceCandidate(new RTCIceCandidate(candidate));
            else iceQueueRef.current.push(candidate);
          } else if (sig.kind === "hangup" || sig.kind === "reject") {
            setStatus("ended");
          }
        } catch (e) { console.error("signal err", e); }
      };

      const drainExistingSignals = async () => {
        const { data: existing } = await supabase
          .from("call_signals")
          .select("id, kind, from_user, payload, created_at")
          .eq("call_id", callIdRef.current)
          .order("created_at", { ascending: true })
          .limit(200);
        for (const sig of (existing || []) as CallSignalRow[]) await processSignal(sig);
      };

      // 3) Signaling channel
      let started = false;
      const ch = supabase
        .channel(`call-${callIdRef.current}-${me}`)
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "call_signals", filter: `call_id=eq.${callIdRef.current}` },
          (payload) => processSignal(payload.new as CallSignalRow)
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
            await drainExistingSignals();
          }
          drainTimerRef.current = setInterval(() => {
            if (pc.connectionState !== "connected" && pc.connectionState !== "closed") drainExistingSignals();
          }, 1500);
        });
      channelRef.current = ch;
      const stopDrain = () => {
        if (drainTimerRef.current) clearInterval(drainTimerRef.current);
        drainTimerRef.current = null;
      };
      pc.addEventListener("connectionstatechange", () => { if (pc.connectionState === "connected") stopDrain(); });
    })();

    return () => {
      cancelled = true;
      try { pcRef.current?.getSenders().forEach((s) => s.track?.stop()); } catch { /* noop */ }
      if (drainTimerRef.current) clearInterval(drainTimerRef.current);
      drainTimerRef.current = null;
      pcRef.current?.close();
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      if (channelRef.current) supabase.removeChannel(channelRef.current);
      sendSignal("hangup", {}).catch(() => {});
      setTimeout(() => cleanupSignals().catch(() => {}), 5000);
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
