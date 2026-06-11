import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { UserAvatar } from "@/components/UserAvatar";
import { toast } from "sonner";
import { Search, Loader2, BadgeCheck } from "lucide-react";

interface Profile {
  id: string; username: string; display_name: string | null; avatar_url: string | null; is_verified: boolean;
}
interface ForwardMessage {
  id: string;
  content: string | null;
  attachment_url: string | null;
  attachment_type: string | null;
}

export function ForwardDialog({
  open, onOpenChange, message, me,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  message: ForwardMessage | null;
  me: string;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState<string | null>(null);

  useEffect(() => {
    if (!open) { setQ(""); setResults([]); return; }
  }, [open]);

  useEffect(() => {
    if (!q.trim()) { setResults([]); return; }
    const t = setTimeout(async () => {
      setLoading(true);
      const { data } = await supabase.from("profiles")
        .select("id, username, display_name, avatar_url, is_verified")
        .or(`username.ilike.%${q}%,display_name.ilike.%${q}%`).limit(20);
      setResults((data || []).filter((p) => p.id !== me));
      setLoading(false);
    }, 300);
    return () => clearTimeout(t);
  }, [q, me]);

  const forwardTo = async (p: Profile) => {
    if (!message) return;
    setSending(p.id);
    const { error } = await supabase.from("messages").insert({
      sender_id: me, receiver_id: p.id,
      content: message.content,
      attachment_url: message.attachment_url,
      attachment_type: message.attachment_type,
      forwarded_from_id: message.id,
    });
    setSending(null);
    if (error) { toast.error(error.message); return; }
    toast.success(`فوروارد شد به ${p.display_name || p.username}`);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>فوروارد به...</DialogTitle></DialogHeader>
        <div className="relative">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="جستجوی کاربر..." className="pr-10" />
        </div>
        <div className="max-h-80 overflow-y-auto -mx-6">
          {loading && <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>}
          {!loading && q && results.length === 0 && <p className="text-center text-sm text-muted-foreground py-6">کاربری یافت نشد</p>}
          <ul className="divide-y">
            {results.map((p) => (
              <li key={p.id}>
                <button
                  disabled={sending === p.id}
                  onClick={() => forwardTo(p)}
                  className="w-full flex items-center gap-3 px-6 py-2.5 hover:bg-accent/50 transition text-right disabled:opacity-50"
                >
                  <UserAvatar avatarPath={p.avatar_url} name={p.display_name || p.username} verified={p.is_verified} className="w-10 h-10" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate flex items-center gap-1">
                      {p.display_name || p.username}
                      {p.is_verified && <BadgeCheck className="w-3.5 h-3.5 text-primary fill-primary stroke-background shrink-0" />}
                    </p>
                    <p className="text-xs text-muted-foreground truncate" dir="ltr">@{p.username}</p>
                  </div>
                  {sending === p.id && <Loader2 className="w-4 h-4 animate-spin" />}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </DialogContent>
    </Dialog>
  );
}
