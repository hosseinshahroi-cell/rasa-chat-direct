import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { NotificationListener } from "@/components/NotificationListener";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });

    // Check profile complete
    const { data: profile } = await supabase
      .from("profiles")
      .select("username, display_name")
      .eq("id", data.user.id)
      .maybeSingle();

    const isComplete = profile && profile.username && !profile.username.startsWith("user");
    const path = window.location.pathname;
    if (!isComplete && path !== "/complete-profile") {
      throw redirect({ to: "/complete-profile" });
    }
    return { user: data.user };
  },
  component: () => (
    <>
      <NotificationListener />
      <Outlet />
    </>
  ),
});
