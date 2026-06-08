import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/UserAvatar";
import { MessageCirclePlus, Settings, Shield, MessageCircle, LogOut, Bookmark, BadgeCheck } from "lucide-react";
import { formatRelativeTime } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/chats/")({
  head: () => ({ meta: [{ title: "گفتگوها - رسا" }] }),
  component: ChatsList,
});

interface ChatItem {
  other_id: string;
  other_username: string;
  other_display_name: string | null;
  other_avatar: string | null;
  other_verified: boolean;
  last_content: string | null;
  last_attachment_type: string | null;
  last_at: string;
  unread: number;
}

function ChatsList() {
  const navigate = useNavigate();
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

  const { data: chats = [] } = useQuery<ChatItem[]>({
    queryKey: ["chats", userId],
    enabled: !!userId,
    queryFn: async () => {
      if (!userId) return [];
      const { data: msgs, error } = await supabase
        .from("messages")
        .select("id, sender_id, receiver_id, content, attachment_type, read_at, created_at")
        .or(`sender_id.eq.${userId},receiver_id.eq.${userId}`)
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      const grouped = new Map<string, ChatItem>();
      const unreadCounts = new Map<string, number>();
      for (const m of msgs ?? []) {
        const other = m.sender_id === userId ? m.receiver_id : m.sender_id;
        if (m.receiver_id === userId && !m.read_at) {
          unreadCounts.set(other, (unreadCounts.get(other) || 0) + 1);
        }
        if (!grouped.has(other)) {
          grouped.set(other, {
            other_id: other,
            other_username: "",
            other_display_name: null,
            other_avatar: null,
            other_verified: false,
            last_content: m.content,
            last_attachment_type: m.attachment_type,
            last_at: m.created_at,
            unread: 0,
          });
        }
      }
      const ids = Array.from(grouped.keys());
      if (ids.length) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("id, username, display_name, avatar_url, is_verified")
          .in("id", ids);
        for (const p of profs ?? []) {
          const c = grouped.get(p.id);
          if (c) {
            c.other_username = p.username;
            c.other_display_name = p.display_name;
            c.other_avatar = p.avatar_url;
            c.other_verified = p.is_verified;
            c.unread = unreadCounts.get(p.id) || 0;
          }
        }
      }
      return Array.from(grouped.values()).sort((a, b) => b.last_at.localeCompare(a.last_at));
    },
  });

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/auth" });
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 bg-card/95 backdrop-blur border-b">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-primary flex items-center justify-center">
              <MessageCircle className="w-5 h-5 text-primary-foreground" />
            </div>
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
            <Button size="icon" variant="ghost" onClick={handleLogout}>
              <LogOut className="w-5 h-5" />
            </Button>
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
              <li key={c.other_id}>
                <Link
                  to="/chats/$userId" params={{ userId: c.other_id }}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-accent/50 transition"
                >
                  <UserAvatar avatarPath={c.other_avatar} name={c.other_display_name || c.other_username} verified={c.other_verified} className="w-12 h-12" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-semibold truncate flex items-center gap-1">
                        {c.other_display_name || c.other_username}
                        {c.other_verified && <BadgeCheck className="w-4 h-4 text-primary fill-primary stroke-background shrink-0" />}
                      </span>
                      <span className="text-xs text-muted-foreground shrink-0">{formatRelativeTime(c.last_at)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm text-muted-foreground truncate">
                        {c.last_attachment_type === "image" ? "🖼 عکس" :
                         c.last_attachment_type === "audio" ? "🎤 پیام صوتی" :
                         c.last_attachment_type === "file" ? "📎 فایل" :
                         c.last_content || "..."}
                      </p>
                      {c.unread > 0 && (
                        <span className="bg-primary text-primary-foreground text-xs rounded-full min-w-5 h-5 px-1.5 flex items-center justify-center font-medium">{c.unread}</span>
                      )}
                    </div>
                  </div>
                </Link>
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
