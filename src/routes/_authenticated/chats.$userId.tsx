import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { UserAvatar } from "@/components/UserAvatar";
import {
  ArrowRight, Send, Paperclip, Image as ImageIcon, Mic, StopCircle, Loader2,
  Bookmark, BadgeCheck, Reply, Pin, Trash2, Pencil, X, Download, Check, CheckCheck, PinOff,
  MoreVertical, Flag, ShieldAlert, Megaphone, Copy as CopyIcon, Forward, Phone, User as UserIcon,
} from "lucide-react";
import { formatChatTime, formatLastSeen } from "@/lib/format";
import { toast } from "sonner";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { VoicePlayer } from "@/components/VoicePlayer";
import { ReportDialog } from "@/components/ReportDialog";
import { ForwardDialog } from "@/components/ForwardDialog";
import { MessageText } from "@/components/MessageText";

const REACTION_EMOJIS = ["❤️", "👍", "👎", "😂", "😮", "😢", "🔥", "🙏"];

interface Reaction { id: string; message_id: string; user_id: string; emoji: string; }

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
  reply_to_id: string | null;
  edited_at: string | null;
  deleted_for_everyone: boolean;
  deleted_for: string[];
  is_pinned: boolean;
  is_announcement: boolean;
}

function ChatView() {
  const { userId: otherId } = Route.useParams();
  const qc = useQueryClient();
  const [me, setMe] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [recording, setRecording] = useState(false);
  const [signedAttachments, setSignedAttachments] = useState<Record<string, string>>({});
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editing, setEditing] = useState<Message | null>(null);
  const [imageView, setImageView] = useState<{ url: string; name: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Message | null>(null);
  const [forwardTarget, setForwardTarget] = useState<Message | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [peerLive, setPeerLive] = useState<{ online: boolean; typing: boolean; recording: boolean }>({ online: false, typing: false, recording: false });
  const fileRef = useRef<HTMLInputElement>(null);
  const imgRef = useRef<HTMLInputElement>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const recChunks = useRef<Blob[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const presenceChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const peerTypingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const peerRecordingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isSelf = me === otherId;

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setMe(data.user?.id ?? null));
  }, []);

  // last-seen heartbeat
  useEffect(() => {
    if (!me) return;
    supabase.rpc("touch_last_seen");
    const t = setInterval(() => supabase.rpc("touch_last_seen"), 30000);
    return () => clearInterval(t);
  }, [me]);

  const { data: other } = useQuery({
    queryKey: ["profile", otherId],
    enabled: !isSelf,
    refetchInterval: 30000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, username, display_name, avatar_url, is_verified, is_scammer, last_seen_at")
        .eq("id", otherId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const peerName = other?.display_name?.trim() || other?.username || "در حال بارگذاری...";
  const peerStatus = peerLive.recording
    ? "در حال ضبط صدا..."
    : peerLive.typing
      ? "در حال تایپ..."
      : peerLive.online
        ? "آنلاین"
        : formatLastSeen(other?.last_seen_at);

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
      return (data as Message[]).filter((m) => !(m.deleted_for || []).includes(me!));
    },
  });

  const messageById = useMemo(() => {
    const map = new Map<string, Message>();
    messages.forEach((m) => map.set(m.id, m));
    return map;
  }, [messages]);

  const pinned = useMemo(
    () => messages.filter((m) => m.is_pinned && !m.deleted_for_everyone),
    [messages],
  );

  const messageIds = useMemo(() => messages.map((m) => m.id), [messages]);

  const { data: reactions = [] } = useQuery<Reaction[]>({
    queryKey: ["reactions", me, otherId, messageIds.length],
    enabled: !!me && messageIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("message_reactions").select("*").in("message_id", messageIds);
      if (error) throw error;
      return (data || []) as Reaction[];
    },
  });

  const reactionsByMessage = useMemo(() => {
    const map = new Map<string, Reaction[]>();
    reactions.forEach((r) => {
      const arr = map.get(r.message_id) || [];
      arr.push(r);
      map.set(r.message_id, arr);
    });
    return map;
  }, [reactions]);

  const toggleReaction = async (messageId: string, emoji: string) => {
    if (!me) return;
    const existing = reactions.find((r) => r.message_id === messageId && r.user_id === me && r.emoji === emoji);
    if (existing) {
      await supabase.from("message_reactions").delete().eq("id", existing.id);
    } else {
      // remove user's other reaction on this message first (one per user per message)
      const mine = reactions.find((r) => r.message_id === messageId && r.user_id === me);
      if (mine) await supabase.from("message_reactions").delete().eq("id", mine.id);
      const { error } = await supabase.from("message_reactions").insert({ message_id: messageId, user_id: me, emoji });
      if (error) toast.error(error.message);
    }
    qc.invalidateQueries({ queryKey: ["reactions", me, otherId] });
  };

  // realtime: messages + reactions + live status
  useEffect(() => {
    if (!me) return;
    const ch = supabase
      .channel(`chat-${me}-${otherId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, (payload) => {
        const m = (payload.new ?? payload.old) as Message;
        if (
          (m.sender_id === me && m.receiver_id === otherId) ||
          (m.sender_id === otherId && m.receiver_id === me) ||
          (isSelf && m.sender_id === me && m.receiver_id === me)
        ) {
          qc.invalidateQueries({ queryKey: ["messages", me, otherId] });
        }
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "message_reactions" }, () => {
        qc.invalidateQueries({ queryKey: ["reactions", me, otherId] });
      })
      .on("presence", { event: "sync" }, () => {
        const state = ch.presenceState<{ user_id: string }>();
        const online = Object.values(state).flat().some((p) => p.user_id === otherId);
        setPeerLive((prev) => ({ ...prev, online }));
      })
      .on("broadcast", { event: "typing" }, ({ payload }) => {
        if ((payload as { user_id?: string }).user_id !== otherId) return;
        setPeerLive((prev) => ({ ...prev, typing: true }));
        if (peerTypingTimerRef.current) clearTimeout(peerTypingTimerRef.current);
        peerTypingTimerRef.current = setTimeout(() => setPeerLive((prev) => ({ ...prev, typing: false })), 2500);
      })
      .on("broadcast", { event: "recording" }, ({ payload }) => {
        const data = payload as { user_id?: string; active?: boolean };
        if (data.user_id !== otherId) return;
        setPeerLive((prev) => ({ ...prev, recording: !!data.active }));
        if (peerRecordingTimerRef.current) clearTimeout(peerRecordingTimerRef.current);
        if (data.active) peerRecordingTimerRef.current = setTimeout(() => setPeerLive((prev) => ({ ...prev, recording: false })), 5000);
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") ch.track({ user_id: me, online_at: new Date().toISOString() });
      });
    presenceChannelRef.current = ch;
    return () => {
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
      if (peerTypingTimerRef.current) clearTimeout(peerTypingTimerRef.current);
      if (peerRecordingTimerRef.current) clearTimeout(peerRecordingTimerRef.current);
      presenceChannelRef.current = null;
      supabase.removeChannel(ch);
    };
  }, [me, otherId, qc, isSelf]);

  const updateText = (value: string) => {
    setText(value);
    if (!me || isSelf) return;
    presenceChannelRef.current?.send({ type: "broadcast", event: "typing", payload: { user_id: me } });
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    typingTimerRef.current = setTimeout(() => {}, 1200);
  };

  // mark as read
  useEffect(() => {
    if (!me || !messages.length) return;
    const unread = messages.filter((m) => m.receiver_id === me && m.sender_id !== me && !m.read_at).map((m) => m.id);
    if (unread.length) {
      supabase.from("messages").update({ read_at: new Date().toISOString() }).in("id", unread).then(() => {
        qc.invalidateQueries({ queryKey: ["chats"] });
      });
    }
  }, [messages, me, qc]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length]);

  // sign attachments
  useEffect(() => {
    const toSign = messages
      .filter((m) => m.attachment_url && !m.deleted_for_everyone && !signedAttachments[m.attachment_url])
      .map((m) => m.attachment_url!);
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
    setSending(true);
    try {
      const { error } = await supabase.from("messages").insert({
        sender_id: me,
        receiver_id: otherId,
        content,
        attachment_url: attachment?.url ?? null,
        attachment_type: attachment?.type ?? null,
        reply_to_id: replyTo?.id ?? null,
      });
      if (error) throw error;
      setText("");
      setReplyTo(null);
      qc.invalidateQueries({ queryKey: ["messages", me, otherId] });
      qc.invalidateQueries({ queryKey: ["chats"] });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "خطا در ارسال";
      toast.error(msg.includes("suspended") ? "حساب شما تعلیق شده است" : msg);
    } finally {
      setSending(false);
    }
  };

  const saveEdit = async () => {
    if (!editing || !text.trim()) return;
    setSending(true);
    const { error } = await supabase.from("messages")
      .update({ content: text.trim(), edited_at: new Date().toISOString() })
      .eq("id", editing.id);
    setSending(false);
    if (error) { toast.error(error.message); return; }
    setEditing(null);
    setText("");
    qc.invalidateQueries({ queryKey: ["messages", me, otherId] });
  };

  const uploadAndSend = async (file: File, type: "image" | "audio" | "file") => {
    if (!me) return;
    const ext = file.name.split(".").pop() || "bin";
    const path = `${me}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error } = await supabase.storage.from("chat-attachments").upload(path, file);
    if (error) { toast.error("خطا در آپلود فایل"); return; }
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
      presenceChannelRef.current?.send({ type: "broadcast", event: "recording", payload: { user_id: me, active: true } });
    } catch {
      toast.error("دسترسی به میکروفون داده نشد");
    }
  };
  const stopRecord = () => {
    recRef.current?.stop();
    setRecording(false);
    if (me) presenceChannelRef.current?.send({ type: "broadcast", event: "recording", payload: { user_id: me, active: false } });
  };

  const togglePin = async (m: Message) => {
    const { error } = await supabase.from("messages").update({ is_pinned: !m.is_pinned }).eq("id", m.id);
    if (error) toast.error(error.message);
    else { toast.success(m.is_pinned ? "از سنجاق برداشته شد" : "سنجاق شد"); qc.invalidateQueries({ queryKey: ["messages", me, otherId] }); }
  };

  const deleteForMe = async (m: Message) => {
    const next = Array.from(new Set([...(m.deleted_for || []), me!]));
    const { error } = await supabase.from("messages").update({ deleted_for: next }).eq("id", m.id);
    if (error) toast.error(error.message);
    else qc.invalidateQueries({ queryKey: ["messages", me, otherId] });
    setDeleteTarget(null);
  };

  const deleteForEveryone = async (m: Message) => {
    const { error } = await supabase.from("messages").update({
      deleted_for_everyone: true,
      content: null, attachment_url: null, attachment_type: null,
    }).eq("id", m.id);
    if (error) toast.error(error.message);
    else qc.invalidateQueries({ queryKey: ["messages", me, otherId] });
    setDeleteTarget(null);
  };

  const beginEdit = (m: Message) => {
    setEditing(m);
    setReplyTo(null);
    setText(m.content || "");
  };

  const cancelCompose = () => {
    setEditing(null);
    setReplyTo(null);
    setText("");
  };

  const submitText = () => {
    if (editing) saveEdit();
    else if (text.trim()) sendMessage(text.trim());
  };

  return (
    <div className="flex flex-col h-screen bg-background">
      <header className="sticky top-0 z-10 bg-card/95 backdrop-blur border-b">
        <div className="max-w-2xl mx-auto px-3 py-2.5 flex items-center gap-3">
          <Link to="/chats">
            <Button size="icon" variant="ghost"><ArrowRight className="w-5 h-5" /></Button>
          </Link>
          {isSelf ? (
            <>
              <div className="w-10 h-10 rounded-full bg-primary/15 text-primary flex items-center justify-center">
                <Bookmark className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold truncate">پیام‌های ذخیره شده</p>
                <p className="text-xs text-muted-foreground truncate">فقط شما این پیام‌ها را می‌بینید</p>
              </div>
            </>
          ) : (
            <>
              {other ? (
                <Link
                  to="/u/$username"
                  params={{ username: other.username }}
                  className="flex items-center gap-3 flex-1 min-w-0 hover:opacity-80 transition"
                >
                  <UserAvatar avatarPath={other.avatar_url} name={other.display_name || other.username} verified={other.is_verified} className="w-10 h-10" />
                  <div className="flex-1 min-w-0 text-right">
                    <p className="font-semibold truncate flex items-center gap-1">
                      {other.display_name || other.username}
                      {other.is_verified && <BadgeCheck className="w-4 h-4 text-primary fill-primary stroke-background shrink-0" />}
                      {other.is_scammer && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] bg-destructive/15 text-destructive px-1.5 py-0.5 rounded-full">
                          <ShieldAlert className="w-3 h-3" /> کلاهبردار
                        </span>
                      )}
                    </p>
                    <p className={`text-xs truncate ${formatLastSeen(other.last_seen_at) === "آنلاین" ? "text-primary" : "text-muted-foreground"}`}>
                      {formatLastSeen(other.last_seen_at)}
                    </p>
                  </div>
                </Link>
              ) : (
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className="w-10 h-10 rounded-full bg-muted animate-pulse" />
                  <div className="flex-1 min-w-0 space-y-1.5">
                    <div className="h-3 w-24 bg-muted rounded animate-pulse" />
                    <div className="h-2.5 w-16 bg-muted/70 rounded animate-pulse" />
                  </div>
                </div>
              )}
              <Link to="/call/$userId" params={{ userId: otherId }}>
                <Button size="icon" variant="ghost" title="تماس صوتی"><Phone className="w-5 h-5 text-primary" /></Button>
              </Link>
              <Popover>
                <PopoverTrigger asChild>
                  <Button size="icon" variant="ghost"><MoreVertical className="w-5 h-5" /></Button>
                </PopoverTrigger>
                <PopoverContent className="w-44 p-1" align="end">
                  <button onClick={() => setReportOpen(true)} className="w-full text-right flex items-center gap-2 px-3 py-2 rounded hover:bg-accent text-sm text-destructive">
                    <Flag className="w-4 h-4" /> گزارش کاربر
                  </button>
                </PopoverContent>
              </Popover>
            </>
          )}
        </div>
        {other?.is_scammer && (
          <div className="bg-destructive/10 border-t border-destructive/20">
            <div className="max-w-2xl mx-auto px-3 py-1.5 text-xs text-destructive flex items-center gap-1.5">
              <ShieldAlert className="w-3.5 h-3.5" />
              این کاربر به عنوان کلاهبردار توسط مدیران علامت‌گذاری شده است.
            </div>
          </div>
        )}
        {pinned.length > 0 && (
          <div className="border-t bg-card/70">
            <div className="max-w-2xl mx-auto px-3 py-1.5 flex items-center gap-2 text-xs">
              <Pin className="w-3.5 h-3.5 text-primary shrink-0" />
              <span className="font-medium text-primary shrink-0">سنجاق شده:</span>
              <span className="truncate text-muted-foreground">
                {pinned[pinned.length - 1].content || (pinned[pinned.length - 1].attachment_type === "image" ? "🖼 عکس" : pinned[pinned.length - 1].attachment_type === "audio" ? "🎤 پیام صوتی" : "📎 فایل")}
              </span>
            </div>
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
            const replied = m.reply_to_id ? messageById.get(m.reply_to_id) : null;
            return (
              <MessageBubble
                key={m.id}
                m={m}
                mine={mine}
                signed={signed}
                replied={replied}
                reactions={reactionsByMessage.get(m.id) || []}
                me={me!}
                onReact={(emoji) => toggleReaction(m.id, emoji)}
                onReply={() => { setReplyTo(m); setEditing(null); }}
                onEdit={() => beginEdit(m)}
                onPin={() => togglePin(m)}
                onDelete={() => setDeleteTarget(m)}
                onForward={() => setForwardTarget(m)}
                onCopy={() => {
                  if (m.content) {
                    navigator.clipboard.writeText(m.content).then(
                      () => toast.success("کپی شد"),
                      () => toast.error("کپی نشد")
                    );
                  } else toast.error("متنی برای کپی نیست");
                }}
                onImageClick={(url) => setImageView({ url, name: m.attachment_url || "image" })}
              />
            );
          })}
        </div>
      </div>

      {!isSelf && other && <ReportDialog open={reportOpen} onOpenChange={setReportOpen} reportedUserId={other.id} /> }
      {me && (
        <ForwardDialog
          open={!!forwardTarget}
          onOpenChange={(o) => !o && setForwardTarget(null)}
          message={forwardTarget}
          me={me}
        />
      )}


      {(replyTo || editing) && (
        <div className="bg-accent/40 border-t">
          <div className="max-w-2xl mx-auto px-3 py-2 flex items-center gap-2">
            {editing ? <Pencil className="w-4 h-4 text-primary shrink-0" /> : <Reply className="w-4 h-4 text-primary shrink-0" />}
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-primary">{editing ? "در حال ویرایش" : "پاسخ به"}</p>
              <p className="text-xs text-muted-foreground truncate">
                {(editing || replyTo)!.content || "پیوست"}
              </p>
            </div>
            <Button size="icon" variant="ghost" onClick={cancelCompose}><X className="w-4 h-4" /></Button>
          </div>
        </div>
      )}

      <div className="sticky bottom-0 bg-card/95 backdrop-blur border-t">
        <div className="max-w-2xl mx-auto p-2 flex items-end gap-1.5">
          {!editing && (
            <>
              <Button size="icon" variant="ghost" onClick={() => fileRef.current?.click()}>
                <Paperclip className="w-5 h-5" />
              </Button>
              <Button size="icon" variant="ghost" onClick={() => imgRef.current?.click()}>
                <ImageIcon className="w-5 h-5" />
              </Button>
              <input ref={fileRef} type="file" hidden onChange={(e) => onFile(e, "file")} />
              <input ref={imgRef} type="file" accept="image/*" hidden onChange={(e) => onFile(e, "image")} />
            </>
          )}
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submitText();
              }
            }}
            placeholder={editing ? "متن جدید..." : "پیام..."}
            className="flex-1"
          />
          {text.trim() || editing ? (
            <Button size="icon" onClick={submitText} disabled={sending}>
              {sending ? <Loader2 className="w-5 h-5 animate-spin" /> : editing ? <Check className="w-5 h-5" /> : <Send className="w-5 h-5" />}
            </Button>
          ) : recording ? (
            <Button size="icon" variant="destructive" onClick={stopRecord}>
              <StopCircle className="w-5 h-5" />
            </Button>
          ) : (
            <Button size="icon" onClick={startRecord}>
              <Mic className="w-5 h-5" />
            </Button>
          )}
        </div>
      </div>

      <Dialog open={!!imageView} onOpenChange={(o) => !o && setImageView(null)}>
        <DialogContent className="max-w-3xl p-2 bg-black/95 border-0">
          {imageView && (
            <div className="flex flex-col items-center gap-3">
              <img src={imageView.url} alt="" className="max-h-[80vh] w-auto rounded" />
              <a href={imageView.url} download target="_blank" rel="noopener noreferrer">
                <Button variant="secondary"><Download className="w-4 h-4 ml-2" /> دانلود</Button>
              </a>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>حذف پیام</AlertDialogTitle>
            <AlertDialogDescription>این پیام رو برای چه کسی حذف کنیم؟</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col sm:flex-row gap-2">
            <AlertDialogCancel>انصراف</AlertDialogCancel>
            <Button variant="outline" onClick={() => deleteTarget && deleteForMe(deleteTarget)}>فقط برای من</Button>
            {deleteTarget?.sender_id === me && (
              <AlertDialogAction onClick={() => deleteTarget && deleteForEveryone(deleteTarget)}>
                برای همه
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function MessageBubble({
  m, mine, signed, replied, reactions, me, onReact, onReply, onEdit, onPin, onDelete, onForward, onCopy, onImageClick,
}: {
  m: Message;
  mine: boolean;
  signed: string | null;
  replied: Message | null | undefined;
  reactions: Reaction[];
  me: string;
  onReact: (emoji: string) => void;
  onReply: () => void;
  onEdit: () => void;
  onPin: () => void;
  onDelete: () => void;
  onForward: () => void;
  onCopy: () => void;
  onImageClick: (url: string) => void;
}) {
  const [open, setOpen] = useState(false);

  if (m.deleted_for_everyone) {
    return (
      <div className={`flex ${mine ? "justify-start" : "justify-end"}`}>
        <div className="max-w-[75%] rounded-2xl px-3 py-2 bg-muted/60 text-muted-foreground italic text-sm">
          این پیام حذف شده است
        </div>
      </div>
    );
  }

  if (m.is_announcement) {
    return (
      <div className="flex justify-center my-2">
        <div className="max-w-[90%] rounded-xl px-3 py-2 bg-primary/10 border border-primary/30 text-center">
          <div className="flex items-center justify-center gap-1.5 text-[11px] font-semibold text-primary mb-1">
            <Megaphone className="w-3.5 h-3.5" /> اطلاعیه از مدیر رسا
          </div>
          {m.content && <p className="text-sm whitespace-pre-wrap break-words">{m.content}</p>}
          <p className="text-[10px] text-muted-foreground mt-1">{formatChatTime(m.created_at)}</p>
        </div>
      </div>
    );
  }

  // group reactions by emoji
  const grouped = new Map<string, { count: number; mine: boolean }>();
  reactions.forEach((r) => {
    const cur = grouped.get(r.emoji) || { count: 0, mine: false };
    cur.count += 1;
    if (r.user_id === me) cur.mine = true;
    grouped.set(r.emoji, cur);
  });

  return (
    <div className={`flex flex-col ${mine ? "items-start" : "items-end"} group`}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            onContextMenu={(e) => { e.preventDefault(); setOpen(true); }}
            className={`max-w-[75%] text-start rounded-2xl px-3 py-2 transition ${
              mine
                ? "bg-[color:var(--color-chat-bubble-me)] text-[color:var(--color-chat-bubble-me-foreground)] rounded-bl-sm"
                : "bg-[color:var(--color-chat-bubble-other)] text-[color:var(--color-chat-bubble-other-foreground)] rounded-br-sm"
            }`}
          >
            {replied && (
              <div className="border-r-2 border-primary/60 pr-2 mb-1 text-xs opacity-80 truncate">
                <p className="font-semibold text-primary">پاسخ</p>
                <p className="truncate">{replied.content || "پیوست"}</p>
              </div>
            )}
            {m.attachment_type === "image" && signed && (
              <img
                src={signed} alt=""
                onClick={(e) => { e.stopPropagation(); onImageClick(signed); }}
                className="rounded-lg max-h-64 mb-1 cursor-zoom-in"
              />
            )}
            {m.attachment_type === "audio" && signed && (
              <VoicePlayer src={signed} mine={mine} />
            )}
            {m.attachment_type === "file" && signed && (
              <a href={signed} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="underline flex items-center gap-2">
                <Paperclip className="w-4 h-4" /> دانلود فایل
              </a>
            )}
            {m.content && <MessageText text={m.content} mine={mine} />}
            <div className={`text-[10px] mt-1 flex items-center gap-1 ${mine ? "opacity-80" : "text-muted-foreground"}`}>
              {m.is_pinned && <Pin className="w-3 h-3" />}
              {m.edited_at && <span>ویرایش شده</span>}
              <span>{formatChatTime(m.created_at)}</span>
              {mine && (m.read_at ? <CheckCheck className="w-3.5 h-3.5" /> : <Check className="w-3.5 h-3.5" />)}
            </div>
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-56 p-1" align={mine ? "start" : "end"}>
          <div className="flex flex-wrap gap-1 px-1 py-1.5 border-b mb-1">
            {REACTION_EMOJIS.map((e) => (
              <button
                key={e}
                onClick={() => { setOpen(false); onReact(e); }}
                className="text-xl w-8 h-8 rounded hover:bg-accent flex items-center justify-center"
              >{e}</button>
            ))}
          </div>
          <button onClick={() => { setOpen(false); onReply(); }} className="w-full text-right flex items-center gap-2 px-3 py-2 rounded hover:bg-accent text-sm">
            <Reply className="w-4 h-4" /> پاسخ
          </button>
          <button onClick={() => { setOpen(false); onForward(); }} className="w-full text-right flex items-center gap-2 px-3 py-2 rounded hover:bg-accent text-sm">
            <Forward className="w-4 h-4" /> فوروارد
          </button>
          {m.content && (
            <button onClick={() => { setOpen(false); onCopy(); }} className="w-full text-right flex items-center gap-2 px-3 py-2 rounded hover:bg-accent text-sm">
              <CopyIcon className="w-4 h-4" /> کپی متن
            </button>
          )}
          <button onClick={() => { setOpen(false); onPin(); }} className="w-full text-right flex items-center gap-2 px-3 py-2 rounded hover:bg-accent text-sm">
            {m.is_pinned ? <PinOff className="w-4 h-4" /> : <Pin className="w-4 h-4" />}
            {m.is_pinned ? "برداشتن سنجاق" : "سنجاق"}
          </button>
          {mine && m.content && (
            <button onClick={() => { setOpen(false); onEdit(); }} className="w-full text-right flex items-center gap-2 px-3 py-2 rounded hover:bg-accent text-sm">
              <Pencil className="w-4 h-4" /> ویرایش
            </button>
          )}
          <button onClick={() => { setOpen(false); onDelete(); }} className="w-full text-right flex items-center gap-2 px-3 py-2 rounded hover:bg-accent text-sm text-destructive">
            <Trash2 className="w-4 h-4" /> حذف
          </button>
        </PopoverContent>
      </Popover>
      {grouped.size > 0 && (
        <div className={`flex flex-wrap gap-1 mt-1 max-w-[75%] ${mine ? "justify-start" : "justify-end"}`}>
          {Array.from(grouped.entries()).map(([emoji, info]) => (
            <button
              key={emoji}
              onClick={() => onReact(emoji)}
              className={`text-xs rounded-full px-2 py-0.5 border transition ${info.mine ? "bg-primary/15 border-primary/40 text-primary" : "bg-card border-border hover:bg-accent"}`}
            >
              <span className="mr-0.5">{emoji}</span>{info.count}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

