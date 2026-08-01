import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { isChatMuted } from "@/lib/cache";

export function NotificationListener() {
  const queryClient = useQueryClient();
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const { data } = await supabase.auth.getUser();
      const userId = data.user?.id;
      if (!userId || cancelled) return;

      // Unique channel name per mount avoids "cannot add callbacks after subscribe"
      const channel = supabase
        .channel(`notify-${userId}-${Math.random().toString(36).slice(2, 8)}`)
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "messages", filter: `receiver_id=eq.${userId}` },
          async (payload) => {
            queryClient.invalidateQueries({ queryKey: ["chats"] });
            queryClient.invalidateQueries({ queryKey: ["messages"] });

            const msg = payload.new as { sender_id: string; content: string | null };
            if (isChatMuted(`dm:${msg.sender_id}`)) return;
            if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
              try {
                const { data: sender } = await supabase
                  .from("profiles")
                  .select("display_name, username")
                  .eq("id", msg.sender_id)
                  .maybeSingle();
                const title = sender?.display_name || sender?.username || "پیام جدید";
                if (document.hidden) {
                  new Notification(title, {
                    body: msg.content || "پیام جدید در رسا",
                    icon: "/favicon.ico",
                    tag: `rasa-${msg.sender_id}`,
                  });
                }
              } catch { /* ignore */ }
            }
          }
        )
        .subscribe();

      if (cancelled) {
        supabase.removeChannel(channel);
        return;
      }
      channelRef.current = channel;
    })();

    return () => {
      cancelled = true;
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [queryClient]);

  return null;
}
