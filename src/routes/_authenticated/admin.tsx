import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { UserAvatar } from "@/components/UserAvatar";
import { ArrowRight, Search, BadgeCheck, Ban, ShieldOff, Users } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter
} from "@/components/ui/dialog";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({ meta: [{ title: "پنل ادمین - رسا" }] }),
  component: AdminPage,
});

interface AdminProfile {
  id: string; username: string; display_name: string | null; avatar_url: string | null;
  is_verified: boolean; suspended_until: string | null; created_at: string;
}

function AdminPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) { navigate({ to: "/auth" }); return; }
      const { data: r } = await supabase.from("user_roles").select("role").eq("user_id", data.user.id);
      const isAdmin = !!r?.some((x) => x.role === "admin");
      setAllowed(isAdmin);
      if (!isAdmin) navigate({ to: "/chats" });
    });
  }, [navigate]);

  const { data: users = [] } = useQuery<AdminProfile[]>({
    queryKey: ["admin-users", q],
    enabled: !!allowed,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_list_users", { search_query: q.trim() });
      if (error) throw error;
      return (data || []) as AdminProfile[];
    },
  });

  const { data: stats } = useQuery({
    queryKey: ["admin-stats"],
    enabled: !!allowed,
    queryFn: async () => {
      const { count } = await supabase.from("profiles").select("id", { count: "exact", head: true });
      const { count: msgCount } = await supabase.from("messages").select("id", { count: "exact", head: true });
      return { users: count || 0, messages: msgCount || 0 };
    },
  });

  const toggleVerified = async (u: AdminProfile) => {
    const { error } = await supabase.rpc("admin_update_user", { target_user: u.id, new_is_verified: !u.is_verified });
    if (error) toast.error(error.message);
    else { toast.success(u.is_verified ? "تیک آبی برداشته شد" : "تیک آبی داده شد"); qc.invalidateQueries({ queryKey: ["admin-users"] }); }
  };

  const suspend = async (u: AdminProfile, until: string | null) => {
    const { error } = await supabase.rpc("admin_update_user", {
      target_user: u.id,
      new_suspended_until: until ?? undefined,
      clear_suspension: until === null,
    });
    if (error) toast.error(error.message);
    else { toast.success(until ? "کاربر تعلیق شد" : "تعلیق برداشته شد"); qc.invalidateQueries({ queryKey: ["admin-users"] }); }
  };

  if (allowed === null) return <div className="min-h-screen flex items-center justify-center text-muted-foreground">در حال بررسی دسترسی...</div>;
  if (!allowed) return null;

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 bg-card/95 backdrop-blur border-b z-10">
        <div className="max-w-3xl mx-auto px-3 py-2.5 flex items-center gap-2">
          <Link to="/chats"><Button size="icon" variant="ghost"><ArrowRight className="w-5 h-5" /></Button></Link>
          <h2 className="font-semibold">پنل ادمین</h2>
        </div>
      </header>

      <main className="max-w-3xl mx-auto p-4 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Card className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary/15 text-primary flex items-center justify-center"><Users className="w-5 h-5" /></div>
              <div>
                <p className="text-xs text-muted-foreground">تعداد کاربران</p>
                <p className="text-2xl font-bold">{stats?.users ?? "—"}</p>
              </div>
            </div>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary/15 text-primary flex items-center justify-center">💬</div>
              <div>
                <p className="text-xs text-muted-foreground">کل پیام‌ها</p>
                <p className="text-2xl font-bold">{stats?.messages ?? "—"}</p>
              </div>
            </div>
          </Card>
        </div>

        <Card className="p-3">
          <div className="relative">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="جستجوی کاربر..." className="pr-10" />
          </div>
        </Card>

        <Card>
          <ul className="divide-y">
            {users.map((u) => {
              const isSuspended = u.suspended_until && new Date(u.suspended_until) > new Date();
              return (
                <li key={u.id} className="p-3 flex items-center gap-3">
                  <UserAvatar avatarPath={u.avatar_url} name={u.display_name || u.username} verified={u.is_verified} className="w-11 h-11" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate flex items-center gap-1">
                      {u.display_name || u.username}
                      {u.is_verified && <BadgeCheck className="w-4 h-4 text-primary fill-primary stroke-background shrink-0" />}
                    </p>
                    <p className="text-xs text-muted-foreground truncate" dir="ltr">@{u.username}</p>
                    {isSuspended && (
                      <p className="text-xs text-destructive mt-0.5">تعلیق تا {new Date(u.suspended_until!).toLocaleDateString("fa-IR")}</p>
                    )}
                  </div>
                  <Button size="sm" variant={u.is_verified ? "secondary" : "outline"} onClick={() => toggleVerified(u)}>
                    <BadgeCheck className="w-4 h-4" />
                  </Button>
                  <SuspendDialog user={u} onSuspend={suspend} />
                </li>
              );
            })}
          </ul>
        </Card>
      </main>
    </div>
  );
}

function SuspendDialog({ user, onSuspend }: { user: AdminProfile; onSuspend: (u: AdminProfile, until: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const [hours, setHours] = useState("24");
  const isSuspended = user.suspended_until && new Date(user.suspended_until) > new Date();

  const apply = () => {
    const h = parseInt(hours);
    if (!h || h <= 0) return;
    const until = new Date(Date.now() + h * 3600 * 1000).toISOString();
    onSuspend(user, until);
    setOpen(false);
  };

  if (isSuspended) {
    return (
      <Button size="sm" variant="outline" onClick={() => onSuspend(user, null)}>
        <ShieldOff className="w-4 h-4" />
      </Button>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline"><Ban className="w-4 h-4" /></Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>تعلیق کاربر</DialogTitle></DialogHeader>
        <div className="space-y-2 py-2">
          <p className="text-sm text-muted-foreground">مدت تعلیق (ساعت):</p>
          <Input type="number" min={1} value={hours} onChange={(e) => setHours(e.target.value)} dir="ltr" />
          <div className="flex gap-2 flex-wrap">
            {[1, 24, 72, 168, 720].map((h) => (
              <Button key={h} size="sm" variant="outline" onClick={() => setHours(String(h))}>{h === 1 ? "۱ ساعت" : h === 24 ? "۱ روز" : h === 72 ? "۳ روز" : h === 168 ? "۱ هفته" : "۱ ماه"}</Button>
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>انصراف</Button>
          <Button onClick={apply}>تعلیق</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
