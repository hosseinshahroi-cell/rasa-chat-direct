import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/join/$token")({
  head: () => ({ meta: [{ title: "پیوستن به گروه - رسا" }] }),
  component: JoinView,
});

function JoinView() {
  const { token } = Route.useParams();
  const navigate = useNavigate();
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    (async () => {
      const { data, error } = await supabase.rpc("group_join_by_token", { p_token: token });
      if (error || !data) {
        toast.error(error?.message || "لینک دعوت نامعتبر است");
        navigate({ to: "/chats" });
        return;
      }
      toast.success("به گروه اضافه شدید");
      navigate({ to: "/group/$groupId", params: { groupId: data as string } });
    })();
  }, [token, navigate]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-3 text-muted-foreground">
      <Loader2 className="w-6 h-6 animate-spin text-primary" />
      <p className="text-sm">در حال پیوستن به گروه...</p>
    </div>
  );
}
