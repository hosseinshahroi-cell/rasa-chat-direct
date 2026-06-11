import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { UserAvatar } from "@/components/UserAvatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ArrowRight, Search, Loader2, BadgeCheck, Camera, Users, Check } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/new-chat")({
  head: () => ({ meta: [{ title: "گفتگوی جدید - رسا" }] }),
  component: NewChat,
});

interface Profile {
  id: string; username: string; display_name: string | null; avatar_url: string | null; is_verified: boolean;
}

function NewChat() {
  const navigate = useNavigate();
  const [me, setMe] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setMe(data.user?.id ?? null));
  }, []);

  useEffect(() => {
    if (!q.trim()) { setResults([]); return; }
    const t = setTimeout(async () => {
      setLoading(true);
      const { data } = await supabase
        .from("profiles")
        .select("id, username, display_name, avatar_url, is_verified")
        .or(`username.ilike.%${q}%,display_name.ilike.%${q}%`)
        .limit(20);
      setResults((data || []).filter((p) => p.id !== me));
      setLoading(false);
    }, 300);
    return () => clearTimeout(t);
  }, [q, me]);

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 bg-card/95 backdrop-blur border-b z-10">
        <div className="max-w-2xl mx-auto px-3 py-2.5 flex items-center gap-2">
          <Link to="/chats"><Button size="icon" variant="ghost"><ArrowRight className="w-5 h-5" /></Button></Link>
          <h2 className="font-semibold">گفتگوی جدید</h2>
        </div>
      </header>
      <main className="max-w-2xl mx-auto p-3">
        <Tabs defaultValue="direct">
          <TabsList className="w-full grid grid-cols-2">
            <TabsTrigger value="direct">گفت‌وگوی شخصی</TabsTrigger>
            <TabsTrigger value="group"><Users className="w-4 h-4 ml-1" /> گروه جدید</TabsTrigger>
          </TabsList>

          <TabsContent value="direct" className="mt-3">
            <div className="relative">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                value={q} onChange={(e) => setQ(e.target.value)}
                placeholder="جستجو با نام یا آیدی..."
                className="pr-10"
              />
            </div>
            {loading && <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>}
            {!loading && q && results.length === 0 && (
              <p className="text-center text-sm text-muted-foreground py-8">کاربری یافت نشد</p>
            )}
            <ul className="divide-y">
              {results.map((p) => (
                <li key={p.id}>
                  <button
                    onClick={() => navigate({ to: "/chats/$userId", params: { userId: p.id } })}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-accent/50 transition text-right"
                  >
                    <UserAvatar avatarPath={p.avatar_url} name={p.display_name || p.username} verified={p.is_verified} className="w-11 h-11" />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate flex items-center gap-1">
                        {p.display_name || p.username}
                        {p.is_verified && <BadgeCheck className="w-4 h-4 text-primary fill-primary stroke-background shrink-0" />}
                      </p>
                      <p className="text-xs text-muted-foreground truncate" dir="ltr">@{p.username}</p>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </TabsContent>

          <TabsContent value="group" className="mt-3">
            <CreateGroupPanel me={me} onCreated={(gid) => toast.success("گروه ساخته شد")} />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

function CreateGroupPanel({ me, onCreated }: { me: string | null; onCreated: (gid: string) => void }) {
  const [name, setName] = useState("");
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Profile[]>([]);
  const [selected, setSelected] = useState<Profile[]>([]);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!q.trim()) { setResults([]); return; }
    const t = setTimeout(async () => {
      const { data } = await supabase.from("profiles")
        .select("id, username, display_name, avatar_url, is_verified")
        .or(`username.ilike.%${q}%,display_name.ilike.%${q}%`).limit(15);
      setResults((data || []).filter((p) => p.id !== me && !selected.find((s) => s.id === p.id)));
    }, 300);
    return () => clearTimeout(t);
  }, [q, me, selected]);

  const onAvatar = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    setAvatarFile(f); setAvatarPreview(URL.createObjectURL(f));
  };

  const create = async () => {
    if (!name.trim()) { toast.error("نام گروه را وارد کنید"); return; }
    if (!me) return;
    setBusy(true);
    try {
      let avatarPath: string | null = null;
      if (avatarFile) {
        const ext = avatarFile.name.split(".").pop() || "jpg";
        const path = `${me}/group-${Date.now()}.${ext}`;
        const { error: upErr } = await supabase.storage.from("avatars").upload(path, avatarFile);
        if (upErr) throw upErr;
        avatarPath = path;
      }
      const { data, error } = await supabase.rpc("create_group", {
        p_name: name.trim(),
        p_avatar: avatarPath,
        p_members: selected.map((s) => s.id),
      });
      if (error) throw error;
      onCreated(data as string);
      setName(""); setAvatarFile(null); setAvatarPreview(null); setSelected([]); setQ("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "خطا در ساخت گروه");
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col items-center gap-2">
        <button onClick={() => fileRef.current?.click()}>
          <Avatar className="w-20 h-20 ring-2 ring-primary/20">
            {avatarPreview && <AvatarImage src={avatarPreview} />}
            <AvatarFallback className="bg-primary/10"><Camera className="w-6 h-6 text-primary" /></AvatarFallback>
          </Avatar>
        </button>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={onAvatar} />
        <p className="text-[10px] text-muted-foreground">عکس پروفایل گروه (اختیاری)</p>
      </div>
      <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="نام گروه..." maxLength={80} />

      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((p) => (
            <button
              key={p.id}
              onClick={() => setSelected(selected.filter((s) => s.id !== p.id))}
              className="text-xs bg-primary/10 text-primary rounded-full px-2.5 py-1 flex items-center gap-1.5"
            >
              {p.display_name || p.username} ✕
            </button>
          ))}
        </div>
      )}

      <div className="relative">
        <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="افزودن اعضا..." className="pr-10" />
      </div>
      <ul className="divide-y max-h-60 overflow-y-auto">
        {results.map((p) => (
          <li key={p.id}>
            <button
              onClick={() => { setSelected([...selected, p]); setQ(""); setResults([]); }}
              className="w-full flex items-center gap-3 px-2 py-2 hover:bg-accent/50 text-right rounded"
            >
              <UserAvatar avatarPath={p.avatar_url} name={p.display_name || p.username} verified={p.is_verified} className="w-9 h-9" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{p.display_name || p.username}</p>
                <p className="text-[11px] text-muted-foreground truncate" dir="ltr">@{p.username}</p>
              </div>
              <Check className="w-4 h-4 text-primary opacity-0 group-hover:opacity-100" />
            </button>
          </li>
        ))}
      </ul>

      <Button onClick={create} disabled={busy || !name.trim()} className="w-full">
        {busy && <Loader2 className="w-4 h-4 ml-2 animate-spin" />}
        ساخت گروه
      </Button>
    </div>
  );
}
