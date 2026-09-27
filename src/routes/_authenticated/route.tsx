import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { NotificationListener } from "@/components/NotificationListener";
import { BroadcastBanner } from "@/components/BroadcastBanner";
import { LanguageProvider } from "@/lib/i18n";
import { IncomingCallListener } from "@/components/IncomingCallListener";
import { PermissionPrompt } from "@/components/PermissionPrompt";
import { OfflineBanner } from "@/components/OfflineBanner";

const PROFILE_OK = "rasa-profile-ok";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data: sess } = await supabase.auth.getSession();
    const localUser = sess.session?.user ?? null;

    // Offline: trust the locally stored session so saved chats stay readable.
    if (!navigator.onLine) {
      if (!localUser) throw redirect({ to: "/auth" });
      return { user: localUser };
    }

    const { data, error } = await supabase.auth.getUser();
    let user = data.user;
    if (error || !user) {
      // Network hiccup with a valid local session: keep the user in.
      if (localUser && error && !("status" in error && error.status === 401)) user = localUser;
      else throw redirect({ to: "/auth" });
    }

    const path = window.location.pathname;
    if (localStorage.getItem(PROFILE_OK) !== user.id) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("username, display_name")
        .eq("id", user.id)
        .maybeSingle();
      const isComplete = profile && profile.username && !profile.username.startsWith("user");
      if (!isComplete && path !== "/complete-profile") {
        throw redirect({ to: "/complete-profile" });
      }
      if (isComplete) localStorage.setItem(PROFILE_OK, user.id);
    }
    return { user };
  },
  component: () => (
    <LanguageProvider>
      <OfflineBanner />
      <PermissionPrompt />
      <NotificationListener />
      <IncomingCallListener />
      <BroadcastBanner />
      <Outlet />
    </LanguageProvider>
  ),
});
