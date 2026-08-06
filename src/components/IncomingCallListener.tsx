import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/UserAvatar";
import { Phone, PhoneOff, Video } from "lucide-react";

interface IncomingCall {
  callId: string;
  fromUser: string;
  fromName: string;
  fromAvatar: string | null;
  isVideo: boolean;
}

export function IncomingCallListener() {
  const navigate = useNavigate();
  const [incoming, setIncoming] = useState<IncomingCall | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const ringRef = useRef<HTMLAudioElement | null>(null);
  const handledRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getUser();
      const me = data.user?.id;
      if (!me || cancelled) return;
      const ch = supabase
        .channel(`incoming-${me}-${Math.random().toString(36).slice(2, 8)}`)
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "call_signals", filter: `to_user=eq.${me}` },
          async (payload) => {
            const sig = payload.new as { kind: string; call_id: string; from_user: string; payload: { video?: boolean } | null };
            if (sig.kind !== "offer") return;
            // ignore duplicate offers for a call we already handled
            if (handledRef.current.has(sig.call_id)) return;
            // skip if already on call page for this caller
            if (window.location.pathname.startsWith("/call/")) return;
            handledRef.current.add(sig.call_id);
            const { data: p } = await supabase
              .from("profiles")
              .select("username, display_name, avatar_url")
              .eq("id", sig.from_user).maybeSingle();
            setIncoming({
              callId: sig.call_id,
              fromUser: sig.from_user,
              fromName: p?.display_name || p?.username || "ناشناس",
              fromAvatar: p?.avatar_url ?? null,
              isVideo: sig.payload?.video === true,
            });
          }
        )
        .subscribe(async (status) => {
          if (status !== "SUBSCRIBED" || cancelled) return;
          const { data: recent } = await supabase
            .from("call_signals")
            .select("call_id, from_user, created_at, payload")
            .eq("to_user", me)
            .eq("kind", "offer")
            .gt("created_at", new Date(Date.now() - 45000).toISOString())
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (!recent || window.location.pathname.startsWith("/call/")) return;
          const { data: p } = await supabase
            .from("profiles")
            .select("username, display_name, avatar_url")
            .eq("id", recent.from_user).maybeSingle();
          setIncoming({
            callId: recent.call_id,
            fromUser: recent.from_user,
            fromName: p?.display_name || p?.username || "ناشناس",
            fromAvatar: p?.avatar_url ?? null,
            isVideo: (recent.payload as { video?: boolean } | null)?.video === true,
          });
        });
      if (cancelled) { supabase.removeChannel(ch); return; }
      channelRef.current = ch;
    })();
    return () => {
      cancelled = true;
      if (channelRef.current) { supabase.removeChannel(channelRef.current); channelRef.current = null; }
    };
  }, []);

  useEffect(() => {
    if (!incoming) { ringRef.current?.pause(); return; }
    const a = ringRef.current;
    if (a) { a.loop = true; a.play().catch(() => {}); }
    const t = setTimeout(() => setIncoming(null), 30000);
    return () => clearTimeout(t);
  }, [incoming]);

  const accept = async () => {
    if (!incoming) return;
    const cid = incoming.callId; const from = incoming.fromUser; const vid = incoming.isVideo;
    setIncoming(null);
    navigate({ to: "/call/$userId", params: { userId: from }, search: { incoming: cid, ...(vid ? { video: "1" } : {}) } as never });
  };

  const reject = async () => {
    if (!incoming) return;
    const { data } = await supabase.auth.getUser();
    if (data.user) {
      await supabase.from("call_signals").insert({
        from_user: data.user.id, to_user: incoming.fromUser, call_id: incoming.callId, kind: "hangup", payload: {},
      });
    }
    setIncoming(null);
  };

  if (!incoming) return null;
  return (
    <Dialog open={true} onOpenChange={(o) => !o && reject()}>
      <DialogContent className="max-w-xs text-center">
        <audio ref={ringRef} src="data:audio/wav;base64,UklGRl9vT19XQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=" />
        <div className="flex flex-col items-center gap-3 py-2">
          <UserAvatar avatarPath={incoming.fromAvatar} name={incoming.fromName} className="w-20 h-20" />
          <div>
            <p className="font-semibold">{incoming.fromName}</p>
            <p className="text-xs text-muted-foreground">{incoming.isVideo ? "تماس تصویری ورودی..." : "تماس صوتی ورودی..."}</p>
          </div>
          <div className="flex gap-3 mt-2">
            <Button onClick={reject} variant="destructive" size="lg" className="rounded-full w-14 h-14 p-0">
              <PhoneOff className="w-6 h-6" />
            </Button>
            <Button onClick={accept} size="lg" className="rounded-full w-14 h-14 p-0 bg-green-600 hover:bg-green-700">
              {incoming.isVideo ? <Video className="w-6 h-6" /> : <Phone className="w-6 h-6" />}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
