import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/UserAvatar";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { MessageCirclePlus, Settings, Shield, MessageCircle, Bookmark, BadgeCheck, Users } from "lucide-react";
import { Logo } from "@/components/Logo";
import { formatRelativeTime } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/chats/")({
  head: () => ({ meta: [{ title: "گفتگوها - رسا" }] }),
  component: ChatsList,
});

interface ChatItem {
  kind: "dm" | "group";
  id: string;
  name: string;
  avatar: string | null;
  verified: boolean;
  last_content: string | null;
  last_attachment_type: string | null;
  last_at: string;
  unread: number;
  member_count?: number;
}

function ChatsList() {
  const [userId, setUserId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return;
      setUserId(data.user.id);
      const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", data.user.id);
      setIsAdmin(!!roles?.some((r) => r.role === "admin"));
    });
  }, []);

  useEffect(() => {
    if (!userId) return;
    supabase.rpc("touch_last_seen");
    const t = setInterval(() => supabase.rpc("touch_last_seen"), 30000);
    return () => clearInterval(t);
  }, [userId]);

  const { data: chats = [] } = useQuery<ChatItem[]>({
    queryKey: ["chats", userId],
    enabled: !!userId,
    refetchInterval: 30000,
    queryFn: async () => {
      if (!userId) return [];

      // 1) Direct messages
      const { data: msgs, error } = await supabase
        .from("messages")
        .select("id, sender_id, receiver_id, group_id, content, attachment_type, read_at, created_at, deleted_for_everyone, deleted_for")
        .or(`sender_id.eq.${userId},receiver_id.eq.${userId}`)
        .is("group_id", null)
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;

      const filtered = (msgs ?? []).filter(
        (m: { deleted_for: string[] | null; receiver_id: string | null }) =>
          m.receiver_id !== null && !(m.deleted_for || []).includes(userId)
      );
      const dms = new Map<string, ChatItem>();
      const unreadCounts = new Map<string, number>();
      for (const m of filtered) {
        const other = (m.sender_id === userId ? m.receiver_id : m.sender_id) as string;
        if (m.receiver_id === userId && !m.read_at && !m.deleted_for_everyone) {
          unreadCounts.set(other, (unreadCounts.get(other) || 0) + 1);
        }
        if (!dms.has(other)) {
          dms.set(other, {
            kind: "dm", id: other, name: "", avatar: null, verified: false,
            last_content: m.deleted_for_everyone ? "🚫 پیام حذف شده" : m.content,
            last_attachment_type: m.deleted_for_everyone ? null : m.attachment_type,
            last_at: m.created_at,
            unread: 0,
          });
        }
      }
      const ids = Array.from(dms.keys());
      if (ids.length) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("id, username, display_name, avatar_url, is_verified")
          .in("id", ids);
        for (const p of profs ?? []) {
          const c = dms.get(p.id);
          if (c) {
            c.name = p.display_name || p.username;
            c.avatar = p.avatar_url;
            c.verified = p.is_verified;
            c.unread = unreadCounts.get(p.id) || 0;
          }
        }
      }

      // 2) Groups
      const { data: groups } = await supabase.rpc("my_groups");
      const groupItems: ChatItem[] = (groups || []).map((g: {
        id: string; name: string; avatar_url: string | null;
        member_count: number; last_msg_at: string | null;
      }) => ({
        kind: "group", id: g.id, name: g.name, avatar: g.avatar_url,
        verified: false, last_content: null, last_attachment_type: null,
        last_at: g.last_msg_at || new Date(0).toISOString(),
        unread: 0, member_count: Number(g.member_count),
      }));

      return [...Array.from(dms.values()), ...groupItems]
        .sort((a, b) => b.last_at.localeCompare(a.last_at));
    },
  });

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 bg-card/95 backdrop-blur border-b">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Logo size={36} />
            <h1 className="text-xl font-bold">رسا</h1>
          </div>
          <div className="flex items-center gap-1">
            {isAdmin && (
              <Link to="/admin">
                <Button size="icon" variant="ghost"><Shield className="w-5 h-5" /></Button>
              </Link>
            )}
            <Link to="/settings">
              <Button size="icon" variant="ghost"><Settings className="w-5 h-5" /></Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto">
        {userId && (
          <Link
            to="/chats/$userId" params={{ userId }}
            className="flex items-center gap-3 px-4 py-3 hover:bg-accent/50 transition border-b"
          >
            <div className="w-12 h-12 rounded-full bg-primary/15 text-primary flex items-center justify-center shrink-0">
              <Bookmark className="w-6 h-6" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold">پیام‌های ذخیره شده</p>
              <p className="text-xs text-muted-foreground">یادداشت‌ها و فایل‌های شخصی شما</p>
            </div>
          </Link>
        )}
        {chats.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center px-4">
            <div className="w-20 h-20 rounded-3xl bg-primary/10 flex items-center justify-center mb-4">
              <MessageCircle className="w-10 h-10 text-primary" />
            </div>
            <h2 className="text-lg font-semibold mb-1">هنوز گفتگویی نداری</h2>
            <p className="text-sm text-muted-foreground mb-4">یک گفتگوی جدید شروع کن</p>
            <Link to="/new-chat">
              <Button><MessageCirclePlus className="w-4 h-4 ml-2" /> شروع گفتگو</Button>
            </Link>
          </div>
        ) : (
          <ul className="divide-y">
            {chats.map((c) => (
              <li key={`${c.kind}-${c.id}`}>
                {c.kind === "dm" ? (
                  <Link
                    to="/chats/$userId" params={{ userId: c.id }}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-accent/50 transition"
                  >
                    <UserAvatar avatarPath={c.avatar} name={c.name} verified={c.verified} className="w-12 h-12" />
                    <ChatRowBody c={c} />
                  </Link>
                ) : (
                  <Link
                    to="/group/$groupId" params={{ groupId: c.id }}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-accent/50 transition"
                  >
                    <Avatar className="w-12 h-12 shrink-0">
                      {c.avatar && <AvatarImage src={c.avatar} />}
                      <AvatarFallback className="bg-primary/15 text-primary"><Users className="w-6 h-6" /></AvatarFallback>
                    </Avatar>
                    <ChatRowBody c={c} />
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
      </main>

      <Link to="/new-chat" className="fixed bottom-6 left-6 z-10">
        <Button size="icon" className="w-14 h-14 rounded-full shadow-lg shadow-primary/30">
          <MessageCirclePlus className="w-6 h-6" />
        </Button>
      </Link>
    </div>
  );
}

function ChatRowBody({ c }: { c: ChatItem }) {
  return (
    <div className="flex-1 min-w-0">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-semibold truncate flex items-center gap-1">
          {c.name || (c.kind === "group" ? "گروه" : "...")}
          {c.verified && <BadgeCheck className="w-4 h-4 text-primary fill-primary stroke-background shrink-0" />}
          {c.kind === "group" && <Users className="w-3.5 h-3.5 text-muted-foreground" />}
        </span>
        <span className="text-xs text-muted-foreground shrink-0">
          {c.last_at && c.last_at !== new Date(0).toISOString() ? formatRelativeTime(c.last_at) : ""}
        </span>
      </div>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground truncate">
          {c.kind === "group"
            ? `${c.member_count ?? 0} عضو`
            : c.last_attachment_type === "image" ? "🖼 عکس"
            : c.last_attachment_type === "audio" ? "🎤 پیام صوتی"
            : c.last_attachment_type === "file" ? "📎 فایل"
            : c.last_content || "..."}
        </p>
        {c.unread > 0 && (
          <span className="bg-primary text-primary-foreground text-xs rounded-full min-w-5 h-5 px-1.5 flex items-center justify-center font-medium">{c.unread}</span>
        )}
      </div>
    </div>
  );
}
