import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { UserAvatar } from "@/components/UserAvatar";
import { ArrowRight, Send, Paperclip, Image as ImageIcon, Mic, StopCircle, Loader2, Bookmark, BadgeCheck } from "lucide-react";
import { formatChatTime } from "@/lib/format";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/chats/$userId")({
  head: () => ({ meta: [{ title: "گفتگو - رسا" }] }),
  component: ChatView,
});

interface Message {
  id: string;
  sender_id: string;
  receiver_id: string;
  content: string | null;
  attachment_url: string | null;
  attachment_type: string | null;
  created_at: string;
  read_at: string | null;
}

function ChatView() {
  const { userId: otherId } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [me, setMe] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [recording, setRecording] = useState(false);
  const [signedAttachments, setSignedAttachments] = useState<Record<string, string>>({});
  const fileRef = useRef<HTMLInputElement>(null);
  const imgRef = useRef<HTMLInputElement>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const recChunks = useRef<Blob[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setMe(data.user?.id ?? null));
  }, []);

  const { data: other } = useQuery({
    queryKey: ["profile", otherId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, username, display_name, avatar_url, is_verified, suspended_until")
        .eq("id", otherId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: messages = [] } = useQuery<Message[]>({
    queryKey: ["messages", me, otherId],
    enabled: !!me,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("messages")
        .select("*")
        .or(`and(sender_id.eq.${me},receiver_id.eq.${otherId}),and(sender_id.eq.${otherId},receiver_id.eq.${me})`)
        .order("created_at", { ascending: true })
        .limit(500);
      if (error) throw error;
      return data as Message[];
    },
  });

  // realtime
  useEffect(() => {
    if (!me) return;
    const ch = supabase
      .channel(`chat-${me}-${otherId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (payload) => {
        const m = payload.new as Message;
        if (
          (m.sender_id === me && m.receiver_id === otherId) ||
          (m.sender_id === otherId && m.receiver_id === me)
        ) {
          qc.invalidateQueries({ queryKey: ["messages", me, otherId] });
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [me, otherId, qc]);

  // mark as read
  useEffect(() => {
    if (!me || !messages.length) return;
    const unread = messages.filter((m) => m.receiver_id === me && !m.read_at).map((m) => m.id);
    if (unread.length) {
      supabase.from("messages").update({ read_at: new Date().toISOString() }).in("id", unread).then(() => {
        qc.invalidateQueries({ queryKey: ["chats"] });
      });
    }
  }, [messages, me, qc]);

  // scroll to bottom
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length]);

  // sign attachments
  useEffect(() => {
    const toSign = messages.filter((m) => m.attachment_url && !signedAttachments[m.attachment_url]).map((m) => m.attachment_url!);
    if (!toSign.length) return;
    (async () => {
      const updates: Record<string, string> = {};
      for (const p of toSign) {
        const { data } = await supabase.storage.from("chat-attachments").createSignedUrl(p, 60 * 60);
        if (data?.signedUrl) updates[p] = data.signedUrl;
      }
      if (Object.keys(updates).length) setSignedAttachments((prev) => ({ ...prev, ...updates }));
    })();
  }, [messages, signedAttachments]);

  const sendMessage = async (content: string | null, attachment?: { url: string; type: string }) => {
    if (!me) return;
    if (other?.suspended_until && new Date(other.suspended_until) > new Date()) {
      toast.error("این کاربر در حال حاضر تعلیق شده است");
      return;
    }
    setSending(true);
    try {
      const { error } = await supabase.from("messages").insert({
        sender_id: me,
        receiver_id: otherId,
        content,
        attachment_url: attachment?.url ?? null,
        attachment_type: attachment?.type ?? null,
      });
      if (error) throw error;
      setText("");
      qc.invalidateQueries({ queryKey: ["messages", me, otherId] });
      qc.invalidateQueries({ queryKey: ["chats"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "خطا در ارسال");
    } finally {
      setSending(false);
    }
  };

  const uploadAndSend = async (file: File, type: "image" | "audio" | "file") => {
    if (!me) return;
    const ext = file.name.split(".").pop() || "bin";
    const path = `${me}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error } = await supabase.storage.from("chat-attachments").upload(path, file);
    if (error) {
      toast.error("خطا در آپلود فایل");
      return;
    }
    await sendMessage(null, { url: path, type });
  };

  const onFile = (e: React.ChangeEvent<HTMLInputElement>, type: "image" | "file") => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 20 * 1024 * 1024) { toast.error("حداکثر ۲۰ مگابایت"); return; }
    uploadAndSend(f, type);
    e.target.value = "";
  };

  const startRecord = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      recChunks.current = [];
      mr.ondataavailable = (e) => recChunks.current.push(e.data);
      mr.onstop = async () => {
        const blob = new Blob(recChunks.current, { type: "audio/webm" });
        const file = new File([blob], `voice-${Date.now()}.webm`, { type: "audio/webm" });
        stream.getTracks().forEach((t) => t.stop());
        await uploadAndSend(file, "audio");
      };
      mr.start();
      recRef.current = mr;
      setRecording(true);
    } catch {
      toast.error("دسترسی به میکروفون داده نشد");
    }
  };
  const stopRecord = () => { recRef.current?.stop(); setRecording(false); };

  const isSuspended = other?.suspended_until && new Date(other.suspended_until) > new Date();

  return (
    <div className="flex flex-col h-screen bg-background">
      <header className="sticky top-0 z-10 bg-card/95 backdrop-blur border-b">
        <div className="max-w-2xl mx-auto px-3 py-2.5 flex items-center gap-3">
          <Link to="/chats">
            <Button size="icon" variant="ghost"><ArrowRight className="w-5 h-5" /></Button>
          </Link>
          {other && (
            <>
              <UserAvatar avatarPath={other.avatar_url} name={other.display_name || other.username} verified={other.is_verified} className="w-10 h-10" />
              <div className="flex-1 min-w-0">
                <p className="font-semibold truncate">{other.display_name || other.username}</p>
                <p className="text-xs text-muted-foreground truncate" dir="ltr">@{other.username}</p>
              </div>
            </>
          )}
        </div>
        {isSuspended && (
          <div className="bg-destructive/10 text-destructive text-xs text-center py-1.5">
            این کاربر تعلیق شده است
          </div>
        )}
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-3 py-4 space-y-2">
          {messages.length === 0 && (
            <div className="text-center text-sm text-muted-foreground py-12">
              شروع گفتگو با ارسال پیام
            </div>
          )}
          {messages.map((m) => {
            const mine = m.sender_id === me;
            const signed = m.attachment_url ? signedAttachments[m.attachment_url] : null;
            return (
              <div key={m.id} className={`flex ${mine ? "justify-start" : "justify-end"}`}>
                <div
                  className={`max-w-[75%] rounded-2xl px-3 py-2 ${
                    mine
                      ? "bg-[color:var(--color-chat-bubble-me)] text-[color:var(--color-chat-bubble-me-foreground)] rounded-bl-sm"
                      : "bg-[color:var(--color-chat-bubble-other)] text-[color:var(--color-chat-bubble-other-foreground)] rounded-br-sm"
                  }`}
                >
                  {m.attachment_type === "image" && signed && (
                    <img src={signed} alt="" className="rounded-lg max-h-64 mb-1" />
                  )}
                  {m.attachment_type === "audio" && signed && (
                    <audio controls src={signed} className="max-w-full" />
                  )}
                  {m.attachment_type === "file" && signed && (
                    <a href={signed} target="_blank" rel="noopener noreferrer" className="underline flex items-center gap-2">
                      <Paperclip className="w-4 h-4" /> دانلود فایل
                    </a>
                  )}
                  {m.content && <p className="whitespace-pre-wrap break-words text-sm">{m.content}</p>}
                  <div className={`text-[10px] mt-1 ${mine ? "opacity-80" : "text-muted-foreground"}`}>
                    {formatChatTime(m.created_at)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="sticky bottom-0 bg-card/95 backdrop-blur border-t">
        <div className="max-w-2xl mx-auto p-2 flex items-end gap-1.5">
          <Button size="icon" variant="ghost" onClick={() => fileRef.current?.click()} disabled={!!isSuspended}>
            <Paperclip className="w-5 h-5" />
          </Button>
          <Button size="icon" variant="ghost" onClick={() => imgRef.current?.click()} disabled={!!isSuspended}>
            <ImageIcon className="w-5 h-5" />
          </Button>
          <input ref={fileRef} type="file" hidden onChange={(e) => onFile(e, "file")} />
          <input ref={imgRef} type="file" accept="image/*" hidden onChange={(e) => onFile(e, "image")} />
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && text.trim()) {
                e.preventDefault();
                sendMessage(text.trim());
              }
            }}
            placeholder={isSuspended ? "ارسال غیرفعال" : "پیام..."}
            className="flex-1"
            disabled={!!isSuspended}
          />
          {text.trim() ? (
            <Button size="icon" onClick={() => sendMessage(text.trim())} disabled={sending || !!isSuspended}>
              {sending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
            </Button>
          ) : recording ? (
            <Button size="icon" variant="destructive" onClick={stopRecord}>
              <StopCircle className="w-5 h-5" />
            </Button>
          ) : (
            <Button size="icon" onClick={startRecord} disabled={!!isSuspended}>
              <Mic className="w-5 h-5" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
