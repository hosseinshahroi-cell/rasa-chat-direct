import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/UserAvatar";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { MessageCirclePlus, Settings, Shield, MessageCircle, Bookmark, BadgeCheck, Users, Search, Radio, Plus, Eye, Loader2, X, Trash2, Heart, Eraser, BellOff, Bell, Check } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Logo, useBranding } from "@/components/Logo";
import { formatRelativeTime } from "@/lib/format";
import { preloadAvatars } from "@/lib/avatar";
import { StoryPlayer, type StoryMedia } from "@/components/StoryPlayer";

import {
  getCachedUserId, setCachedUserId, readSnapshot, writeSnapshot,
  getMutedChats, setChatMuted, getHiddenChats, hideChats,
} from "@/lib/cache";
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
  like_count: number;
  viewed_by_me: boolean;
  liked_by_me: boolean;
}

interface StoryViewer {
  user_id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  viewed_at: string;
  liked: boolean;
}

function ChatsList() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [userId, setUserId] = useState<string | null>(() => getCachedUserId());
  const [authReady, setAuthReady] = useState<boolean>(() => !!getCachedUserId());
  const [isAdmin, setIsAdmin] = useState(false);
  const [search, setSearch] = useState("");
  const { data: branding } = useBranding();
  const [selected, setSelected] = useState<string[]>([]);
  const [muted, setMuted] = useState<string[]>([]);
  const [hidden, setHidden] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setMuted(getMutedChats());
    setHidden(getHiddenChats());
  }, []);

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
    initialData: () => (userId ? readSnapshot<ChatItem[]>(`chats:${userId}`) : undefined),
    initialDataUpdatedAt: 0,
    queryFn: async () => {
      if (!userId) return [];

      // direct messages + groups in parallel
      const [msgRes, groupRes] = await Promise.all([
        supabase
          .from("messages")
          .select("id, sender_id, receiver_id, content, attachment_type, read_at, created_at, deleted_for_everyone, deleted_for")
          .or(`sender_id.eq.${userId},receiver_id.eq.${userId}`)
          .is("group_id", null)
          .order("created_at", { ascending: false })
          .limit(400),
        supabase.rpc("my_groups"),
      ]);
      if (msgRes.error) throw msgRes.error;

      const filtered = (msgRes.data ?? []).filter(
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

      const groupItems: ChatItem[] = ((groupRes.data || []) as Array<{
        id: string; name: string; avatar_url: string | null;
        member_count: number; last_msg_at: string | null; is_channel?: boolean;
      }>).map((g) => ({
        kind: g.is_channel ? "channel" : "group", id: g.id, name: g.name, avatar: g.avatar_url,
        verified: false, last_content: null, last_attachment_type: null,
        last_at: g.last_msg_at || new Date(0).toISOString(),
        unread: 0, member_count: Number(g.member_count),
      }));

      const result = [...Array.from(dms.values()), ...groupItems]
        .sort((a, b) => b.last_at.localeCompare(a.last_at));
      writeSnapshot(`chats:${userId}`, result);
      return result;
    },
  });

  // warm every avatar (batch-signed) so pictures never pop in late
  useEffect(() => {
    if (!chats.length) return;
    void preloadAvatars(chats.map((c) => c.avatar));
  }, [chats]);

  // preload the most recent conversations so opening them is instant
  useEffect(() => {
    if (!userId || !chats.length) return;
    const recentDms = chats.filter((c) => c.kind === "dm").slice(0, 5);
    for (const c of recentDms) {
      void qc.prefetchQuery({
        queryKey: ["messages", userId, c.id],
        staleTime: 15_000,
        queryFn: async () => {
          const { data, error } = await supabase
            .from("messages")
            .select("*")
            .or(`and(sender_id.eq.${userId},receiver_id.eq.${c.id}),and(sender_id.eq.${c.id},receiver_id.eq.${userId})`)
            .order("created_at", { ascending: true })
            .limit(500);
          if (error) throw error;
          const list = (data || []).filter(
            (m: { deleted_for: string[] | null }) => !(m.deleted_for || []).includes(userId),
          );
          writeSnapshot(`messages:${userId}:${c.id}`, list);
          return list;
        },
      });
    }
  }, [chats, userId, qc]);




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

  const visibleChats = useMemo(
    () => chats.filter((c) => !hidden.includes(`${c.kind}:${c.id}`)),
    [chats, hidden],
  );

  const keyOf = (c: ChatItem) => `${c.kind}:${c.id}`;
  const selectionMode = selected.length > 0;
  const toggleSelect = (k: string) =>
    setSelected((cur) => (cur.includes(k) ? cur.filter((i) => i !== k) : [...cur, k]));
  const clearSelection = () => setSelected([]);
  const allMuted = selectionMode && selected.every((k) => muted.includes(k));

  const purgeMessagesFor = async (dmPeerIds: string[]) => {
    if (!userId || dmPeerIds.length === 0) return;
    for (const peer of dmPeerIds) {
      const { data: rows } = await supabase
        .from("messages")
        .select("id, deleted_for")
        .is("group_id", null)
        .or(`and(sender_id.eq.${userId},receiver_id.eq.${peer}),and(sender_id.eq.${peer},receiver_id.eq.${userId})`)
        .limit(1000);
      const list = (rows || []) as { id: string; deleted_for: string[] | null }[];
      for (let i = 0; i < list.length; i += 25) {
        await Promise.all(
          list.slice(i, i + 25).map((m) =>
            supabase
              .from("messages")
              .update({ deleted_for: Array.from(new Set([...(m.deleted_for || []), userId])) })
              .eq("id", m.id),
          ),
        );
      }
    }
  };

  const runOnSelection = async (mode: "delete" | "clear") => {
    if (!userId || busy) return;
    setBusy(true);
    try {
      const dmPeers = selected.filter((k) => k.startsWith("dm:")).map((k) => k.slice(3));
      await purgeMessagesFor(dmPeers);
      if (mode === "delete") {
        const others = selected.filter((k) => !k.startsWith("dm:"));
        if (others.length) { hideChats(others); setHidden(getHiddenChats()); }
      }
      qc.invalidateQueries({ queryKey: ["chats", userId] });
      toast.success(mode === "delete" ? "گفتگو حذف شد" : "تاریخچه پاک شد");
      clearSelection();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "خطا در انجام عملیات");
    } finally {
      setBusy(false);
    }
  };

  const toggleMuteSelection = () => {
    setChatMuted(selected, !allMuted);
    setMuted(getMutedChats());
    toast.success(!allMuted ? "بی‌صدا شد" : "صدا فعال شد");
    clearSelection();
  };

  const openChat = (c: ChatItem) => {
    if (c.kind === "dm") navigate({ to: "/chats/$userId", params: { userId: c.id } });
    else navigate({ to: "/group/$groupId", params: { groupId: c.id } });
  };

  const openSearchResult = (item: SearchItem) => {
    if (item.kind === "user") navigate({ to: "/chats/$userId", params: { userId: item.id } });
    else navigate({ to: "/group/$groupId", params: { groupId: item.id } });
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 bg-card/95 backdrop-blur border-b">
        {selectionMode ? (
          <div className="max-w-2xl mx-auto px-3 py-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Button size="icon" variant="ghost" onClick={clearSelection} title="لغو">
                <X className="w-5 h-5" />
              </Button>
              <span className="text-sm font-semibold">{selected.length} انتخاب شده</span>
              <Button
                size="sm"
                variant="ghost"
                className="text-xs"
                onClick={() =>
                  setSelected(
                    selected.length === visibleChats.length ? [] : visibleChats.map(keyOf),
                  )
                }
              >
                {selected.length === visibleChats.length ? "لغو همه" : "انتخاب همه"}
              </Button>
            </div>

            <div className="flex items-center gap-1">
              <Button size="icon" variant="ghost" onClick={toggleMuteSelection} title={allMuted ? "فعال کردن صدا" : "بی‌صدا"}>
                {allMuted ? <Bell className="w-5 h-5" /> : <BellOff className="w-5 h-5" />}
              </Button>
              <Button size="icon" variant="ghost" onClick={() => runOnSelection("clear")} disabled={busy} title="پاک کردن تاریخچه">
                <Eraser className="w-5 h-5" />
              </Button>
              <Button size="icon" variant="ghost" onClick={() => runOnSelection("delete")} disabled={busy} title="حذف گفتگو">
                {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <Trash2 className="w-5 h-5 text-destructive" />}
              </Button>
            </div>
          </div>
        ) : (
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Logo size={36} />
            <h1 className="text-xl font-bold">{branding?.app_name || "رسا"}</h1>
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
        )}
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
        {visibleChats.length === 0 ? (
          (!authReady || chatsLoading || chatsFetching) ? (
            <ul className="divide-y">
              {Array.from({ length: 7 }).map((_, i) => (
                <li key={i} className="flex items-center gap-3 px-4 py-3 animate-pulse">
                  <div className="w-12 h-12 rounded-full bg-muted shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3.5 w-32 rounded bg-muted" />
                    <div className="h-3 w-48 rounded bg-muted/70" />
                  </div>
                </li>
              ))}
            </ul>
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
            {visibleChats.map((c) => (
              <li key={keyOf(c)}>
                <ChatRow
                  c={c}
                  muted={muted.includes(keyOf(c))}
                  selected={selected.includes(keyOf(c))}
                  selectionMode={selectionMode}
                  onOpen={() => openChat(c)}
                  onToggle={() => toggleSelect(keyOf(c))}
                />
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

function ChatRow({
  c, muted, selected, selectionMode, onOpen, onToggle,
}: {
  c: ChatItem; muted: boolean; selected: boolean; selectionMode: boolean;
  onOpen: () => void; onToggle: () => void;
}) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longRef = useRef(false);
  const startPos = useRef<{ x: number; y: number } | null>(null);

  const start = (e: React.PointerEvent) => {
    longRef.current = false;
    startPos.current = { x: e.clientX, y: e.clientY };
    timerRef.current = setTimeout(() => {
      longRef.current = true;
      if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(15);
      onToggle();
    }, 350);
  };
  const cancel = () => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
  };
  const move = (e: React.PointerEvent) => {
    const p = startPos.current;
    if (!p) return;
    if (Math.abs(e.clientX - p.x) > 8 || Math.abs(e.clientY - p.y) > 8) cancel();
  };
  const click = () => {
    cancel();
    if (longRef.current) { longRef.current = false; return; }
    if (selectionMode) onToggle();
    else onOpen();
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onPointerDown={start}
      onPointerMove={move}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onContextMenu={(e) => { e.preventDefault(); onToggle(); }}
      onClick={click}
      onKeyDown={(e) => { if (e.key === "Enter") click(); }}
      className={`flex items-center gap-3 px-4 py-3 transition-colors cursor-pointer select-none touch-pan-y ${
        selected ? "bg-primary/15" : "hover:bg-accent/50 active:bg-accent/60"
      }`}
    >
      {selectionMode && (
        <span
          className={`shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
            selected ? "bg-primary border-primary text-primary-foreground" : "border-muted-foreground/40"
          }`}
        >
          {selected && <Check className="w-3 h-3" />}
        </span>
      )}
      <div className="relative shrink-0">
        <UserAvatar
          avatarPath={c.avatar} name={c.name}
          verified={c.kind === "dm" ? c.verified : false}
          className="w-12 h-12"
        />
      </div>
      <ChatRowBody c={c} />
      {muted && <BellOff className="w-4 h-4 text-muted-foreground shrink-0" />}
    </div>
  );
}


function StoriesBar({ me }: { me: string | null }) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [activeUser, setActiveUser] = useState<string | null>(null);

  const [showViewers, setShowViewers] = useState(false);
  const [viewers, setViewers] = useState<StoryViewer[]>([]);

  const { data: stories = [] } = useQuery<StoryItem[]>({
    queryKey: ["stories"],
    enabled: !!me,
    refetchInterval: 60000,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("active_stories");
      if (error) throw error;
      return (data || []).map((s: StoryItem) => ({
        ...s,
        view_count: Number(s.view_count),
        like_count: Number(s.like_count || 0),
      }));
    },
  });

  useEffect(() => {
    if (!me) return;
    const ch = supabase
      .channel("stories-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "stories" }, () => qc.invalidateQueries({ queryKey: ["stories"] }))
      .on("postgres_changes", { event: "*", schema: "public", table: "story_views" }, () => qc.invalidateQueries({ queryKey: ["stories"] }))
      .on("postgres_changes", { event: "*", schema: "public", table: "story_likes" }, () => qc.invalidateQueries({ queryKey: ["stories"] }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [me, qc]);

  const loadViewers = async (storyId: string) => {
    const { data } = await (supabase.rpc as any)("story_viewers", { p_story: storyId });
    setViewers((data as StoryViewer[]) || []);
  };

  const toggleLike = async (story: StoryItem) => {
    await (supabase.rpc as any)("toggle_story_like", { p_story: story.id });
    qc.invalidateQueries({ queryKey: ["stories"] });
  };




  const onStoryFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !me) return;
    const isVideo = file.type.startsWith("video/");
    const isImage = file.type.startsWith("image/");
    if (!isImage && !isVideo) { toast.error("فقط عکس یا ویدئو قابل انتشار است"); return; }
    if (file.size > 100 * 1024 * 1024) { toast.error("حداکثر حجم استوری ۱۰۰ مگابایت است"); return; }
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
    setActiveUser(null);
    qc.invalidateQueries({ queryKey: ["stories"] });
  };

  const grouped = useMemo(() => {
    const map = new Map<string, StoryItem>();
    stories.forEach((s) => { if (!map.has(s.user_id)) map.set(s.user_id, s); });
    return Array.from(map.values());
  }, [stories]);

  const activeStories = useMemo(
    () =>
      activeUser
        ? stories
            .filter((s) => s.user_id === activeUser)
            .slice()
            .sort((a, b) => a.created_at.localeCompare(b.created_at))
        : [],
    [stories, activeUser]
  );


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
          <button key={s.id} onClick={() => setActiveUser(s.user_id)} className="flex flex-col items-center gap-1 text-xs min-w-16">
            <span className={`rounded-full p-0.5 ${s.viewed_by_me ? "bg-muted" : "bg-primary"}`}>
              <UserAvatar avatarPath={s.avatar_url} name={s.display_name || s.username} className="w-14 h-14 ring-2 ring-background" />
            </span>
            <span className="max-w-16 truncate">{s.user_id === me ? "استوری من" : s.display_name || s.username}</span>
          </button>
        ))}
      </div>
      {activeStories.length > 0 && (
        <StoryPlayer
          stories={activeStories}
          me={me}
          onClose={() => setActiveUser(null)}
          onView={(s) => {
            (supabase.rpc as any)("view_story", { p_story: s.id }).then(() =>
              qc.invalidateQueries({ queryKey: ["stories"] })
            );
          }}
          onLike={(s) => toggleLike(s as StoryItem)}
          onDelete={(s) => deleteStory(s as StoryItem)}
          onOpenViewers={(s) => { loadViewers(s.id); setShowViewers(true); }}
        />
      )}

      <Sheet open={showViewers} onOpenChange={setShowViewers}>
        <SheetContent side="bottom" className="max-h-[70vh] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>بازدیدکنندگان</SheetTitle>
          </SheetHeader>
          <div className="mt-3 space-y-1">
            {viewers.length === 0 && <p className="text-sm text-muted-foreground text-center py-6">هنوز کسی استوری را ندیده</p>}
            {viewers.map((v) => (
              <div key={v.user_id} className="flex items-center gap-2 py-2 border-b last:border-0">
                <UserAvatar avatarPath={v.avatar_url} name={v.display_name || v.username} className="w-9 h-9" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{v.display_name || v.username}</p>
                  <p className="text-[11px] text-muted-foreground truncate">@{v.username}</p>
                </div>
                {v.liked && <Heart className="w-4 h-4 fill-red-500 text-red-500" />}
              </div>
            ))}
          </div>
        </SheetContent>
      </Sheet>
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
