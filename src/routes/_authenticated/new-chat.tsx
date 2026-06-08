import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { UserAvatar } from "@/components/UserAvatar";
import { ArrowRight, Search, Loader2, BadgeCheck } from "lucide-react";

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
        <div className="max-w-2xl mx-auto px-3 pb-3">
          <div className="relative">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              value={q} onChange={(e) => setQ(e.target.value)}
              placeholder="جستجو با نام یا آیدی..."
              className="pr-10"
            />
          </div>
        </div>
      </header>
      <main className="max-w-2xl mx-auto">
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
                  <p className="font-medium truncate">{p.display_name || p.username}</p>
                  <p className="text-xs text-muted-foreground truncate" dir="ltr">@{p.username}</p>
                </div>
              </button>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
