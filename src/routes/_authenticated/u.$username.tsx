import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { UserAvatar } from "@/components/UserAvatar";
import { ArrowRight, BadgeCheck, ShieldAlert, MessageCircle, Flag, Ban, Loader2, MoreVertical, UserCheck } from "lucide-react";
import { formatLastSeen } from "@/lib/format";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ReportDialog } from "@/components/ReportDialog";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/u/$username")({
  head: () => ({ meta: [{ title: "پروفایل - رسا" }] }),
  component: ProfileView,
});

interface ProfileLookup {
  id: string; username: string; display_name: string | null; avatar_url: string | null;
  is_verified: boolean; is_scammer: boolean; bio: string | null; last_seen_at: string | null;
}

function ProfileView() {
  const { username } = Route.useParams();
  const navigate = useNavigate();
  const [me, setMe] = useState<string | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [blockBusy, setBlockBusy] = useState(false);
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setMe(data.user?.id ?? null));
  }, []);

  const { data, isLoading, error } = useQuery({
    queryKey: ["profile-lookup", username],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("lookup_profile_by_username", { p_username: username });
      if (error) throw error;
      const row = (data as ProfileLookup[])?.[0];
      if (!row) throw new Error("not-found");
      return row;
    },
  });

  useEffect(() => {
    if (!me || !data) return;
    supabase.from("user_blocks").select("blocker_id")
      .eq("blocker_id", me).eq("blocked_id", data.id).maybeSingle()
      .then(({ data: b }) => setBlocked(!!b));
  }, [me, data]);

  const toggleBlock = async () => {
    if (!me || !data) return;
    setBlockBusy(true);
    if (blocked) {
      await supabase.from("user_blocks").delete().eq("blocker_id", me).eq("blocked_id", data.id);
      setBlocked(false); toast.success("از حالت مسدود خارج شد");
    } else {
      const { error } = await supabase.from("user_blocks").insert({ blocker_id: me, blocked_id: data.id });
      if (error) toast.error(error.message); else { setBlocked(true); toast.success("کاربر مسدود شد"); }
    }
    setBlockBusy(false);
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 bg-card/95 backdrop-blur border-b z-10">
        <div className="max-w-2xl mx-auto px-3 py-2.5 flex items-center gap-2">
          <Button size="icon" variant="ghost" onClick={() => history.back()}>
            <ArrowRight className="w-5 h-5" />
          </Button>
          <h2 className="font-semibold">پروفایل</h2>
          {data && me && me !== data.id && (
            <div className="mr-auto">
              <Popover>
                <PopoverTrigger asChild>
                  <Button size="icon" variant="ghost"><MoreVertical className="w-5 h-5" /></Button>
                </PopoverTrigger>
                <PopoverContent className="w-48 p-1" align="end">
                  <button onClick={toggleBlock} disabled={blockBusy} className="w-full text-right flex items-center gap-2 px-3 py-2 rounded hover:bg-accent text-sm">
                    {blocked ? <UserCheck className="w-4 h-4" /> : <Ban className="w-4 h-4" />}
                    {blocked ? "رفع مسدودی" : "مسدود کردن"}
                  </button>
                  <button onClick={() => setReportOpen(true)} className="w-full text-right flex items-center gap-2 px-3 py-2 rounded hover:bg-accent text-sm text-destructive">
                    <Flag className="w-4 h-4" /> گزارش کاربر
                  </button>
                </PopoverContent>
              </Popover>
            </div>
          )}
        </div>
      </header>
      <main className="max-w-2xl mx-auto p-4">
        {isLoading && <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>}
        {error && (
          <Card className="p-8 text-center space-y-3">
            <p className="text-lg font-semibold">کاربری با این آیدی پیدا نشد</p>
            <p className="text-sm text-muted-foreground">@{username}</p>
            <Link to="/chats"><Button variant="outline" className="mt-2">بازگشت</Button></Link>
          </Card>
        )}
        {data && (
          <Card className="p-6 space-y-4 text-center">
            <div className="flex justify-center">
              <UserAvatar avatarPath={data.avatar_url} name={data.display_name || data.username} verified={data.is_verified} className="w-24 h-24" />
            </div>
            <div className="space-y-1">
              <h1 className="text-2xl font-bold flex items-center justify-center gap-1.5">
                {data.display_name || data.username}
                {data.is_verified && <BadgeCheck className="w-6 h-6 text-primary fill-primary stroke-background" />}
              </h1>
              <p className="text-sm text-muted-foreground" dir="ltr">@{data.username}</p>
              {data.is_scammer && (
                <p className="inline-flex items-center gap-1 text-xs bg-destructive/15 text-destructive px-2 py-1 rounded-full">
                  <ShieldAlert className="w-3.5 h-3.5" /> کلاهبردار - با احتیاط
                </p>
              )}
              <p className={`text-xs ${formatLastSeen(data.last_seen_at) === "آنلاین" ? "text-primary" : "text-muted-foreground"}`}>
                {formatLastSeen(data.last_seen_at)}
              </p>
            </div>
            {data.bio && <p className="text-sm whitespace-pre-wrap text-foreground/80 bg-muted/40 rounded-lg p-3 text-start">{data.bio}</p>}
            {me && me !== data.id && (
              <Button className="w-full" onClick={() => navigate({ to: "/chats/$userId", params: { userId: data.id } })}>
                <MessageCircle className="w-4 h-4 ml-2" /> ارسال پیام
              </Button>
            )}
          </Card>
        )}
        {data && me && <ReportDialog open={reportOpen} onOpenChange={setReportOpen} reportedUserId={data.id} />}
      </main>
    </div>
  );
}
