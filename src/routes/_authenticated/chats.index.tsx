import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/UserAvatar";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { MessageCirclePlus, Settings, Shield, MessageCircle, Bookmark, BadgeCheck, Users, Search, Radio, Plus, Eye, Loader2, X, Trash2 } from "lucide-react";
import { Logo } from "@/components/Logo";
import { formatRelativeTime } from "@/lib/format";
import { getCachedUserId, setCachedUserId } from "@/lib/cache";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/chats/")({
  head: () => ({ meta: [{ title: "گفتگوها - رسا" }] }),
  component: ChatsList,
});

interface ChatItem {
  kind: "dm" | "group" | "channel";
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

interface SearchItem {
  kind: "user" | "group" | "channel";
  id: string;
  username: string | null;
  name: string;
  avatar_url: string | null;
  is_verified: boolean;
  member_count: number;
}

interface StoryItem {
  id: string;
  user_id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  media_url: string;
  media_type: "image" | "video";
  caption: string | null;
  created_at: string;
  expires_at: string;
  view_count: number;
  viewed_by_me: boolean;
}

function ChatsList() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [userId, setUserId] = useState<string | null>(() => getCachedUserId());
  const [authReady, setAuthReady] = useState<boolean>(() => !!getCachedUserId());
  const [isAdmin, setIsAdmin] = useState(false);
  const [search, setSearch] = useState("");

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      setAuthReady(true);
      if (!data.user) { setCachedUserId(null); setUserId(null); return; }
      setUserId(data.user.id);
      setCachedUserId(data.user.id);
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

  const { data: chats = [], isLoading: chatsLoading, isFetching: chatsFetching } = useQuery<ChatItem[]>({
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
      const groupItems: ChatItem[] = ((groups || []) as Array<{
        id: string; name: string; avatar_url: string | null;
        member_count: number; last_msg_at: string | null; is_channel?: boolean;
      }>).map((g) => ({
        kind: g.is_channel ? "channel" : "group", id: g.id, name: g.name, avatar: g.avatar_url,
        verified: false, last_content: null, last_attachment_type: null,
        last_at: g.last_msg_at || new Date(0).toISOString(),
        unread: 0, member_count: Number(g.member_count),
      }));

      return [...Array.from(dms.values()), ...groupItems]
        .sort((a, b) => b.last_at.localeCompare(a.last_at));
    },
  });

  const { data: searchResults = [], isFetching: searching } = useQuery<SearchItem[]>({
    queryKey: ["global-search", search],
    enabled: search.trim().length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("global_search", { p_query: search.trim() });
      if (error) throw error;
      return (data || []) as SearchItem[];
    },
  });

  useEffect(() => {
    if (!userId) return;
    const ch = supabase
      .channel(`chat-list-${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, () => qc.invalidateQueries({ queryKey: ["chats", userId] }))
      .on("postgres_changes", { event: "*", schema: "public", table: "groups" }, () => qc.invalidateQueries({ queryKey: ["chats", userId] }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [userId, qc]);

  const openSearchResult = (item: SearchItem) => {
    if (item.kind === "user") navigate({ to: "/chats/$userId", params: { userId: item.id } });
    else navigate({ to: "/group/$groupId", params: { groupId: item.id } });
  };

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
        <StoriesBar me={userId} />
        <div className="px-4 py-3 border-b bg-background">
          <div className="relative">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="جستجوی کاربر، گروه یا کانال..." className="pr-10 pl-10" />
            {search && <button onClick={() => setSearch("")} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"><X className="w-4 h-4" /></button>}
          </div>
          {search.trim() && (
            <div className="mt-2 rounded-lg border bg-card overflow-hidden">
              {searching && <div className="flex justify-center py-5"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>}
              {!searching && searchResults.length === 0 && <p className="text-center text-xs text-muted-foreground py-5">نتیجه‌ای پیدا نشد</p>}
              {searchResults.map((item) => (
                <button key={`${item.kind}-${item.id}`} onClick={() => openSearchResult(item)} className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-accent/50 text-right border-b last:border-b-0">
                  <UserAvatar avatarPath={item.avatar_url} name={item.name} verified={item.is_verified} className="w-10 h-10" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate flex items-center gap-1">
                      {item.name}
                      {item.kind === "group" && <Users className="w-3.5 h-3.5 text-muted-foreground" />}
                      {item.kind === "channel" && <Radio className="w-3.5 h-3.5 text-primary" />}
                      {item.is_verified && <BadgeCheck className="w-3.5 h-3.5 text-primary fill-primary stroke-background" />}
                    </p>
                    <p className="text-[11px] text-muted-foreground truncate" dir="ltr">
                      {item.kind === "user" && item.username ? `@${item.username}` : `${item.member_count || 0} عضو`}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
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
          (!authReady || chatsLoading || chatsFetching) ? (
            <div className="flex flex-col items-center justify-center py-20">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
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
          )
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
                    <UserAvatar avatarPath={c.avatar} name={c.name} className="w-12 h-12" />
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

function StoriesBar({ me }: { me: string | null }) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [viewer, setViewer] = useState<StoryItem | null>(null);
  const [signed, setSigned] = useState<string | null>(null);

  const { data: stories = [] } = useQuery<StoryItem[]>({
    queryKey: ["stories"],
    enabled: !!me,
    refetchInterval: 60000,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("active_stories");
      if (error) throw error;
      return (data || []).map((s: StoryItem) => ({ ...s, view_count: Number(s.view_count) }));
    },
  });

  useEffect(() => {
    if (!me) return;
    const ch = supabase
      .channel("stories-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "stories" }, () => qc.invalidateQueries({ queryKey: ["stories"] }))
      .on("postgres_changes", { event: "*", schema: "public", table: "story_views" }, () => qc.invalidateQueries({ queryKey: ["stories"] }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [me, qc]);

  useEffect(() => {
    if (!viewer) { setSigned(null); return; }
    let alive = true;
    supabase.storage.from("chat-attachments").createSignedUrl(viewer.media_url, 60 * 20).then(({ data }) => {
      if (alive) setSigned(data?.signedUrl ?? null);
    });
    if (me && viewer.user_id !== me) (supabase.rpc as any)("view_story", { p_story: viewer.id }).then(() => qc.invalidateQueries({ queryKey: ["stories"] }));
    return () => { alive = false; };
  }, [viewer, me, qc]);

  const onStoryFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !me) return;
    const isVideo = file.type.startsWith("video/");
    const isImage = file.type.startsWith("image/");
    if (!isImage && !isVideo) { toast.error("فقط عکس یا ویدئو قابل انتشار است"); return; }
    if (file.size > 50 * 1024 * 1024) { toast.error("حداکثر حجم استوری ۵۰ مگابایت است"); return; }
    setUploading(true);
    try {
      const ext = file.name.split(".").pop() || (isVideo ? "mp4" : "jpg");
      const path = `${me}/story-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("chat-attachments").upload(path, file);
      if (upErr) throw upErr;
      const { error } = await supabase.from("stories").insert({ user_id: me, media_url: path, media_type: isVideo ? "video" : "image" });
      if (error) throw error;
      toast.success("استوری منتشر شد");
      qc.invalidateQueries({ queryKey: ["stories"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "خطا در انتشار استوری");
    } finally { setUploading(false); }
  };

  const deleteStory = async (story: StoryItem) => {
    if (!me || story.user_id !== me) return;
    const { error } = await supabase.from("stories").delete().eq("id", story.id).eq("user_id", me);
    if (error) { toast.error(error.message); return; }
    await supabase.storage.from("chat-attachments").remove([story.media_url]);
    toast.success("استوری حذف شد");
    setViewer(null);
    qc.invalidateQueries({ queryKey: ["stories"] });
  };

  const grouped = useMemo(() => {
    const map = new Map<string, StoryItem>();
    stories.forEach((s) => { if (!map.has(s.user_id)) map.set(s.user_id, s); });
    return Array.from(map.values());
  }, [stories]);

  return (
    <div className="border-b bg-card/60 px-3 py-3 overflow-x-auto">
      <div className="flex items-center gap-3 min-w-max">
        <button onClick={() => fileRef.current?.click()} disabled={uploading || !me} className="flex flex-col items-center gap-1 text-xs text-muted-foreground disabled:opacity-50">
          <span className="w-14 h-14 rounded-full border-2 border-dashed border-primary/50 bg-primary/10 text-primary flex items-center justify-center">
            {uploading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Plus className="w-6 h-6" />}
          </span>
          استوری من
        </button>
        <input ref={fileRef} type="file" accept="image/*,video/*" hidden onChange={onStoryFile} />
        {grouped.map((s) => (
          <button key={s.id} onClick={() => setViewer(s)} className="flex flex-col items-center gap-1 text-xs min-w-16">
            <span className={`rounded-full p-0.5 ${s.viewed_by_me ? "bg-muted" : "bg-primary"}`}>
              <UserAvatar avatarPath={s.avatar_url} name={s.display_name || s.username} className="w-14 h-14 ring-2 ring-background" />
            </span>
            <span className="max-w-16 truncate">{s.user_id === me ? "استوری من" : s.display_name || s.username}</span>
          </button>
        ))}
      </div>
      <Dialog open={!!viewer} onOpenChange={(o) => !o && setViewer(null)}>
        <DialogContent className="max-w-sm p-0 overflow-hidden bg-background border-0">
          {viewer && (
            <div className="relative min-h-[70vh] bg-black flex items-center justify-center">
              {!signed && <Loader2 className="w-6 h-6 animate-spin text-primary" />}
              {signed && viewer.media_type === "image" && <img src={signed} alt="استوری" className="max-h-[80vh] w-full object-contain" />}
              {signed && viewer.media_type === "video" && <video src={signed} controls autoPlay className="max-h-[80vh] w-full" />}
              <div className="absolute top-0 inset-x-0 p-3 bg-gradient-to-b from-black/70 to-transparent text-primary-foreground">
                <div className="flex items-center gap-2">
                  <UserAvatar avatarPath={viewer.avatar_url} name={viewer.display_name || viewer.username} className="w-9 h-9" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate">{viewer.display_name || viewer.username}</p>
                    <p className="text-[11px] opacity-80">{formatRelativeTime(viewer.created_at)}</p>
                  </div>
                  <span className="inline-flex items-center gap-1 text-xs"><Eye className="w-3.5 h-3.5" /> {viewer.view_count}</span>
                  {viewer.user_id === me && (
                    <Button size="icon" variant="destructive" className="h-8 w-8 rounded-full" onClick={() => deleteStory(viewer)} title="حذف استوری">
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ChatRowBody({ c }: { c: ChatItem }) {
  return (
    <div className="flex-1 min-w-0">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-semibold truncate flex items-center gap-1">
          {c.name || (c.kind === "channel" ? "کانال" : c.kind === "group" ? "گروه" : "...")}
          {c.verified && <BadgeCheck className="w-4 h-4 text-primary fill-primary stroke-background shrink-0" />}
          {c.kind === "group" && <Users className="w-3.5 h-3.5 text-muted-foreground" />}
          {c.kind === "channel" && <Radio className="w-3.5 h-3.5 text-primary" />}
        </span>
        <span className="text-xs text-muted-foreground shrink-0">
          {c.last_at && c.last_at !== new Date(0).toISOString() ? formatRelativeTime(c.last_at) : ""}
        </span>
      </div>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground truncate">
          {c.kind === "group" || c.kind === "channel"
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
