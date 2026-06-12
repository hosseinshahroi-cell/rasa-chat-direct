import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Megaphone, X } from "lucide-react";

interface Ann { id: string; content: string | null; created_at: string; }

const STORAGE_KEY = "rasa_dismissed_broadcast";
const MUTE_KEY = "rasa_mute_announcements";

export function BroadcastBanner() {
  const [ann, setAnn] = useState<Ann | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined" && localStorage.getItem(MUTE_KEY) === "1") return;
    let cancelled = false;
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;
      const { data } = await supabase
        .from("messages")
        .select("id, content, created_at")
        .eq("is_announcement", true)
        .eq("receiver_id", u.user.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancelled || !data) return;
      const dismissed = localStorage.getItem(STORAGE_KEY);
      if (dismissed === data.id) return;
      setAnn(data as Ann);
      setVisible(true);
      const t = setTimeout(() => setVisible(false), 10000);
      return () => clearTimeout(t);
    })();
    return () => { cancelled = true; };
  }, []);

  const dismiss = () => {
    if (ann) localStorage.setItem(STORAGE_KEY, ann.id);
    setVisible(false);
  };

  if (!visible || !ann) return null;
  return (
    <div className="fixed top-0 inset-x-0 z-50 bg-primary text-primary-foreground shadow-md animate-in slide-in-from-top duration-300">
      <div className="max-w-3xl mx-auto px-3 py-2 flex items-center gap-2">
        <Megaphone className="w-4 h-4 shrink-0" />
        <p className="text-sm flex-1 truncate"><span className="font-semibold ml-1">اعلان:</span>{ann.content}</p>
        <button onClick={dismiss} className="opacity-80 hover:opacity-100 shrink-0">
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
