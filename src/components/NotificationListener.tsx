import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";

export function NotificationListener() {
  const queryClient = useQueryClient();

  useEffect(() => {
    let userId: string | null = null;

    supabase.auth.getUser().then(({ data }) => {
      userId = data.user?.id ?? null;
      if (!userId) return;

      const channel = supabase
        .channel(`notify-${userId}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "messages",
            filter: `receiver_id=eq.${userId}`,
          },
          async (payload) => {
            queryClient.invalidateQueries({ queryKey: ["chats"] });
            queryClient.invalidateQueries({ queryKey: ["messages"] });

            const msg = payload.new as { sender_id: string; content: string | null };
            // browser notification
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
              } catch {
                // ignore
              }
            }
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    });
  }, [queryClient]);

  return null;
}
