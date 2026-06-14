import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { UserAvatar } from "@/components/UserAvatar";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import {
  ArrowRight, Send, Loader2, Users, Settings as SettingsIcon, Copy, LogOut, Crown, Shield as ShieldIcon, Radio, Save,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatChatTime } from "@/lib/format";
import { MessageText } from "@/components/MessageText";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/group/$groupId")({
  head: () => ({ meta: [{ title: "گروه - رسا" }] }),
  component: GroupView,
});

interface GroupMsg {
  id: string; sender_id: string; group_id: string; content: string | null;
  attachment_url: string | null; attachment_type: string | null; created_at: string;
  deleted_for_everyone: boolean;
}
interface Member {
  user_id: string; username: string; display_name: string | null;
  avatar_url: string | null; is_verified: boolean; role: string;
}
interface GroupInfo {
  id: string; name: string; avatar_url: string | null; owner_id: string; invite_token: string;
  lock_members_send: boolean; is_channel: boolean; description: string | null; public_username: string | null;
}

function GroupView() {
  const { groupId } = Route.useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [me, setMe] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editUsername, setEditUsername] = useState("");
  const [editLocked, setEditLocked] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => { supabase.auth.getUser().then(({ data }) => setMe(data.user?.id ?? null)); }, []);

  const { data: group } = useQuery<GroupInfo | null>({
    queryKey: ["group", groupId],
    queryFn: async () => {
      const { data, error } = await supabase.from("groups")
        .select("id, name, avatar_url, owner_id, invite_token, lock_members_send, is_channel, description, public_username")
        .eq("id", groupId).maybeSingle();
      if (error) throw error;
      return data as GroupInfo | null;
    },
  });

  useEffect(() => {
    if (!group) return;
    setEditName(group.name);
    setEditDescription(group.description || "");
    setEditUsername(group.public_username || "");
    setEditLocked(group.lock_members_send);
  }, [group]);

  const { data: members = [] } = useQuery<Member[]>({
    queryKey: ["group-members", groupId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("group_members_list", { p_gid: groupId });
      if (error) throw error;
      return (data || []) as Member[];
    },
  });

  const { data: messages = [] } = useQuery<GroupMsg[]>({
    queryKey: ["group-messages", groupId],
    enabled: !!me,
    queryFn: async () => {
      const { data, error } = await supabase.from("messages")
        .select("id, sender_id, group_id, content, attachment_url, attachment_type, created_at, deleted_for_everyone")
        .eq("group_id", groupId)
        .order("created_at", { ascending: true })
        .limit(500);
      if (error) throw error;
      return (data || []) as GroupMsg[];
    },
  });

  useEffect(() => {
    if (!me) return;
    const ch = supabase.channel(`group-${groupId}`)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "messages", filter: `group_id=eq.${groupId}` },
        () => qc.invalidateQueries({ queryKey: ["group-messages", groupId] }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [me, groupId, qc]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length]);

  const memberById = new Map(members.map((m) => [m.user_id, m]));
  const myRole = members.find((m) => m.user_id === me)?.role;
  const canManage = myRole === "owner" || myRole === "admin";
  const canSend = !group?.is_channel || canManage;

  const send = async () => {
    if (!text.trim() || !me) return;
    setSending(true);
    const { error } = await supabase.from("messages").insert({
      sender_id: me, group_id: groupId, content: text.trim(),
    });
    setSending(false);
    if (error) { toast.error(error.message); return; }
    setText("");
    qc.invalidateQueries({ queryKey: ["group-messages", groupId] });
  };

  const leaveGroup = async () => {
    if (!me) return;
    const { error } = await supabase.rpc("group_remove_member", { p_gid: groupId, p_user: me });
    if (error) { toast.error(error.message); return; }
    toast.success("از گروه خارج شدید");
    navigate({ to: "/chats" });
  };

  const copyInvite = () => {
    if (!group?.invite_token) return;
    const link = `${window.location.origin}/join/${group.invite_token}`;
    navigator.clipboard.writeText(link);
    toast.success("لینک دعوت کپی شد");
  };

  const regenInvite = async () => {
    const { error } = await supabase.rpc("group_regen_invite", { p_gid: groupId });
    if (error) { toast.error(error.message); return; }
    qc.invalidateQueries({ queryKey: ["group", groupId] });
    toast.success("لینک جدید ساخته شد");
  };

  const saveSettings = async () => {
    if (!canManage || !group) return;
    setSavingSettings(true);
    const { error } = await (supabase.rpc as any)("group_update_settings", {
      p_gid: groupId,
      p_name: editName.trim() || group.name,
      p_avatar: undefined,
      p_lock_members: editLocked,
      p_description: editDescription.trim() || undefined,
      p_public_username: editUsername.trim() || undefined,
    });
    setSavingSettings(false);
    if (error) { toast.error(error.message); return; }
    toast.success("تنظیمات ذخیره شد");
    qc.invalidateQueries({ queryKey: ["group", groupId] });
    qc.invalidateQueries({ queryKey: ["chats"] });
  };

  return (
    <div className="flex flex-col h-screen bg-background">
      <header className="sticky top-0 z-10 bg-card/95 backdrop-blur border-b">
        <div className="max-w-2xl mx-auto px-3 py-2.5 flex items-center gap-3">
          <Link to="/chats"><Button size="icon" variant="ghost"><ArrowRight className="w-5 h-5" /></Button></Link>
          {group ? (
            <button onClick={() => setSettingsOpen(true)} className="flex items-center gap-3 flex-1 min-w-0 hover:opacity-80 text-right">
              <Avatar className="w-10 h-10">
                {group.avatar_url && <AvatarImage src={group.avatar_url} />}
                <AvatarFallback className="bg-primary/15 text-primary"><Users className="w-5 h-5" /></AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="font-semibold truncate flex items-center gap-1">{group.name}{group.is_channel && <Radio className="w-3.5 h-3.5 text-primary" />}</p>
                <p className="text-xs text-muted-foreground truncate">{group.is_channel ? "کانال" : "گروه"} · {members.length} عضو</p>
              </div>
            </button>
          ) : (
            <div className="flex-1 flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-muted animate-pulse" />
              <div className="h-3 w-24 bg-muted rounded animate-pulse" />
            </div>
          )}
          <Button size="icon" variant="ghost" onClick={() => setSettingsOpen(true)}><SettingsIcon className="w-5 h-5" /></Button>
        </div>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-3 py-4 space-y-2">
          {messages.length === 0 && <p className="text-center text-sm text-muted-foreground py-12">هنوز پیامی نیست</p>}
          {messages.map((m) => {
            const mine = m.sender_id === me;
            const sender = memberById.get(m.sender_id);
            if (m.deleted_for_everyone) {
              return <div key={m.id} className={`flex ${mine ? "justify-start" : "justify-end"}`}>
                <div className="max-w-[75%] rounded-2xl px-3 py-2 bg-muted/60 text-muted-foreground italic text-sm">پیام حذف شده</div>
              </div>;
            }
            return (
              <div key={m.id} className={`flex flex-col ${mine ? "items-start" : "items-end"}`}>
                <div className={`max-w-[75%] rounded-2xl px-3 py-2 ${mine ? "bg-[color:var(--color-chat-bubble-me)] text-[color:var(--color-chat-bubble-me-foreground)] rounded-bl-sm" : "bg-[color:var(--color-chat-bubble-other)] text-[color:var(--color-chat-bubble-other-foreground)] rounded-br-sm"}`}>
                  {!mine && sender && (
                    <p className="text-[11px] font-semibold text-primary mb-0.5">{sender.display_name || sender.username}</p>
                  )}
                  {m.content && <MessageText text={m.content} mine={mine} />}
                  <div className="text-[10px] mt-1 opacity-80">{formatChatTime(m.created_at)}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="sticky bottom-0 bg-card/95 backdrop-blur border-t">
        <div className="max-w-2xl mx-auto p-2 flex items-end gap-1.5">
          <Input
            value={text} onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder={canSend ? (group?.is_channel ? "ارسال پست در کانال..." : "پیام در گروه...") : "فقط مدیران کانال می‌توانند ارسال کنند"}
            disabled={!canSend}
            className="flex-1"
          />
          <Button size="icon" onClick={send} disabled={sending || !text.trim() || !canSend}>
            {sending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
          </Button>
        </div>
      </div>

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{group?.is_channel ? "مدیریت کانال" : "مدیریت گروه"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            {canManage && group && (
              <div className="border rounded-lg p-3 space-y-3">
                <p className="text-xs font-semibold">تنظیمات اصلی</p>
                <Input value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="نام" maxLength={80} />
                {group.is_channel && (
                  <div className="relative">
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">@</span>
                    <Input value={editUsername} onChange={(e) => setEditUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, "").toLowerCase())} placeholder="آیدی کانال" className="pr-7" dir="ltr" maxLength={30} />
                  </div>
                )}
                <Textarea value={editDescription} onChange={(e) => setEditDescription(e.target.value)} placeholder="توضیحات" maxLength={180} />
                {!group.is_channel && (
                  <div className="flex items-center justify-between rounded-md bg-muted/40 p-2">
                    <span className="text-sm">ارسال فقط برای ادمین‌ها</span>
                    <Switch checked={editLocked} onCheckedChange={setEditLocked} />
                  </div>
                )}
                <Button onClick={saveSettings} disabled={savingSettings || !editName.trim()} className="w-full" size="sm">
                  {savingSettings ? <Loader2 className="w-4 h-4 ml-2 animate-spin" /> : <Save className="w-4 h-4 ml-2" />}
                  ذخیره تنظیمات
                </Button>
              </div>
            )}
            {canManage && group?.invite_token && !group.is_channel && (
              <div className="border rounded-lg p-3 space-y-2">
                <p className="text-xs font-semibold">لینک دعوت</p>
                <div className="flex gap-1.5">
                  <Input readOnly dir="ltr" value={`${typeof window !== "undefined" ? window.location.origin : ""}/join/${group.invite_token}`} className="text-xs" />
                  <Button size="icon" variant="outline" onClick={copyInvite}><Copy className="w-4 h-4" /></Button>
                </div>
                <Button size="sm" variant="ghost" onClick={regenInvite}>ساخت لینک جدید</Button>
              </div>
            )}
            <div>
              <p className="text-xs font-semibold mb-2">اعضا ({members.length})</p>
              <ul className="space-y-1.5 max-h-72 overflow-y-auto">
                {members.map((m) => (
                  <li key={m.user_id} className="flex items-center gap-2.5 py-1.5">
                    <UserAvatar avatarPath={m.avatar_url} name={m.display_name || m.username} verified={m.is_verified} className="w-9 h-9" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{m.display_name || m.username}</p>
                      <p className="text-[11px] text-muted-foreground truncate" dir="ltr">@{m.username}</p>
                    </div>
                    {m.role === "owner" && <Crown className="w-4 h-4 text-amber-500" />}
                    {m.role === "admin" && <ShieldIcon className="w-4 h-4 text-primary" />}
                  </li>
                ))}
              </ul>
            </div>
            <Button variant="destructive" className="w-full" onClick={leaveGroup}>
              <LogOut className="w-4 h-4 ml-2" /> ترک گروه
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
