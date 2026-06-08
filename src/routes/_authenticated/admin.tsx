import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { UserAvatar } from "@/components/UserAvatar";
import {
  ArrowRight, Search, BadgeCheck, Ban, ShieldOff, Users, MessageSquare, Activity,
  UserPlus, Wifi, Trash2, ShieldAlert, Flag, Megaphone, Settings2, Lock, MoreVertical,
} from "lucide-react";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatRelativeTime } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({ meta: [{ title: "پنل ادمین - رسا" }] }),
  component: AdminPage,
});

interface AdminProfile {
  id: string; username: string; display_name: string | null; avatar_url: string | null;
  is_verified: boolean; is_scammer: boolean;
  lock_text: boolean; lock_voice: boolean; lock_video: boolean; lock_file: boolean; lock_image: boolean;
  suspended_until: string | null; created_at: string;
}

interface GlobalLocks { text: boolean; voice: boolean; video: boolean; file: boolean; image: boolean; }

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
    refetchInterval: 30000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_stats");
      if (error) throw error;
      return data as Record<string, number>;
    },
  });

  const { data: recent = [] } = useQuery({
    queryKey: ["admin-recent-messages"],
    enabled: !!allowed,
    refetchInterval: 15000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_recent_messages", { limit_n: 30 });
      if (error) throw error;
      return data as Array<{
        id: string; sender_id: string; receiver_id: string;
        sender_username: string; receiver_username: string;
        content: string | null; attachment_type: string | null;
        created_at: string; deleted_for_everyone: boolean;
      }>;
    },
  });

  const { data: reports = [] } = useQuery({
    queryKey: ["admin-reports"],
    enabled: !!allowed,
    refetchInterval: 20000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_list_reports", { only_open: false });
      if (error) throw error;
      return data as Array<{
        id: string; reporter_id: string; reported_user_id: string;
        reporter_username: string; reported_username: string;
        subject: string; reason: string; status: string; created_at: string;
      }>;
    },
  });

  const { data: globalLocks } = useQuery<GlobalLocks>({
    queryKey: ["app-settings", "global_locks"],
    enabled: !!allowed,
    queryFn: async () => {
      const { data, error } = await supabase.from("app_settings").select("value").eq("key", "global_locks").maybeSingle();
      if (error) throw error;
      return (data?.value as GlobalLocks) || { text: false, voice: false, video: false, file: false, image: false };
    },
  });

  const deleteMsg = async (id: string) => {
    const { error } = await supabase.rpc("admin_delete_message", { msg_id: id });
    if (error) toast.error(error.message);
    else { toast.success("پیام حذف شد"); qc.invalidateQueries({ queryKey: ["admin-recent-messages"] }); }
  };

  const setFlags = async (u: AdminProfile, flags: Partial<AdminProfile>) => {
    const { error } = await supabase.rpc("admin_set_user_flags", {
      target: u.id,
      p_is_scammer: flags.is_scammer ?? undefined,
      p_lock_text: flags.lock_text ?? undefined,
      p_lock_voice: flags.lock_voice ?? undefined,
      p_lock_video: flags.lock_video ?? undefined,
      p_lock_file: flags.lock_file ?? undefined,
      p_lock_image: flags.lock_image ?? undefined,
    });
    if (error) toast.error(error.message);
    else { toast.success("ذخیره شد"); qc.invalidateQueries({ queryKey: ["admin-users"] }); }
  };

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

  const deleteAccount = async (u: AdminProfile) => {
    const { error } = await supabase.rpc("admin_delete_user", { target: u.id });
    if (error) toast.error(error.message);
    else { toast.success("حساب حذف شد"); qc.invalidateQueries({ queryKey: ["admin-users"] }); }
  };

  const resolveReport = async (id: string, status: string) => {
    const { error } = await supabase.rpc("admin_resolve_report", { report_id: id, new_status: status });
    if (error) toast.error(error.message);
    else { toast.success("وضعیت گزارش به‌روزرسانی شد"); qc.invalidateQueries({ queryKey: ["admin-reports"] }); }
  };

  const setGlobalLock = async (key: keyof GlobalLocks, value: boolean) => {
    const next = { ...(globalLocks || { text: false, voice: false, video: false, file: false, image: false }), [key]: value };
    const { error } = await supabase.rpc("admin_set_global_locks", { locks: next });
    if (error) toast.error(error.message);
    else { toast.success("اعمال شد"); qc.invalidateQueries({ queryKey: ["app-settings", "global_locks"] }); }
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
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard icon={<Users className="w-5 h-5" />} label="کاربران" value={stats?.users} />
          <StatCard icon={<MessageSquare className="w-5 h-5" />} label="پیام‌ها" value={stats?.messages} />
          <StatCard icon={<Wifi className="w-5 h-5" />} label="آنلاین الان" value={stats?.online_now} highlight />
          <StatCard icon={<Activity className="w-5 h-5" />} label="فعال امروز" value={stats?.active_today} />
          <StatCard icon={<BadgeCheck className="w-5 h-5" />} label="تأیید شده" value={stats?.verified} />
          <StatCard icon={<Ban className="w-5 h-5" />} label="تعلیق فعال" value={stats?.suspended} />
          <StatCard icon={<ShieldAlert className="w-5 h-5" />} label="کلاهبردار" value={stats?.scammers} />
          <StatCard icon={<Flag className="w-5 h-5" />} label="گزارش‌های باز" value={stats?.open_reports} highlight />
        </div>

        <Tabs defaultValue="users">
          <TabsList className="w-full grid grid-cols-4">
            <TabsTrigger value="users">کاربران</TabsTrigger>
            <TabsTrigger value="reports">گزارش‌ها</TabsTrigger>
            <TabsTrigger value="broadcast">اعلان</TabsTrigger>
            <TabsTrigger value="controls">تنظیمات</TabsTrigger>
          </TabsList>

          <TabsContent value="users" className="space-y-3 mt-3">
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
                          {u.is_scammer && <ShieldAlert className="w-4 h-4 text-destructive shrink-0" />}
                        </p>
                        <p className="text-xs text-muted-foreground truncate" dir="ltr">@{u.username}</p>
                        {isSuspended && (
                          <p className="text-xs text-destructive mt-0.5">تعلیق تا {new Date(u.suspended_until!).toLocaleDateString("fa-IR")}</p>
                        )}
                      </div>
                      <Button size="sm" variant={u.is_verified ? "secondary" : "outline"} onClick={() => toggleVerified(u)} title="تیک آبی">
                        <BadgeCheck className="w-4 h-4" />
                      </Button>
                      <SuspendDialog user={u} onSuspend={suspend} />
                      <UserMoreMenu user={u} onSetFlags={setFlags} onDelete={deleteAccount} />
                    </li>
                  );
                })}
              </ul>
            </Card>

            <Card>
              <div className="px-4 py-3 border-b">
                <h3 className="font-semibold text-sm">آخرین پیام‌ها</h3>
              </div>
              <ul className="divide-y max-h-96 overflow-y-auto">
                {recent.length === 0 && (
                  <li className="text-center text-xs text-muted-foreground py-6">پیامی نیست</li>
                )}
                {recent.map((m) => (
                  <li key={m.id} className="p-3 flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-muted-foreground" dir="ltr">@{m.sender_username} → @{m.receiver_username}</p>
                      <p className={`text-sm truncate ${m.deleted_for_everyone ? "italic text-muted-foreground" : ""}`}>
                        {m.deleted_for_everyone ? "حذف شده توسط ادمین" :
                         m.attachment_type === "image" ? "🖼 عکس" :
                         m.attachment_type === "audio" ? "🎤 صدا" :
                         m.attachment_type === "file" ? "📎 فایل" :
                         m.content || "—"}
                      </p>
                      <p className="text-[10px] text-muted-foreground">{formatRelativeTime(m.created_at)}</p>
                    </div>
                    {!m.deleted_for_everyone && (
                      <Button size="icon" variant="ghost" onClick={() => deleteMsg(m.id)}>
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          </TabsContent>

          <TabsContent value="reports" className="mt-3">
            <Card>
              <div className="px-4 py-3 border-b flex items-center gap-2">
                <Flag className="w-4 h-4 text-primary" />
                <h3 className="font-semibold text-sm">گزارش‌های کاربران</h3>
              </div>
              <ul className="divide-y">
                {reports.length === 0 && <li className="text-center text-xs text-muted-foreground py-6">گزارشی نیست</li>}
                {reports.map((r) => (
                  <li key={r.id} className="p-3 space-y-1.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full ${r.status === "open" ? "bg-destructive/15 text-destructive" : "bg-muted text-muted-foreground"}`}>
                        {r.status === "open" ? "باز" : r.status === "resolved" ? "حل شده" : r.status}
                      </span>
                      <span className="text-xs font-semibold">{r.subject}</span>
                      <span className="text-[10px] text-muted-foreground mr-auto">{formatRelativeTime(r.created_at)}</span>
                    </div>
                    <p className="text-xs text-muted-foreground" dir="ltr">
                      گزارش‌دهنده: @{r.reporter_username} ← متهم: @{r.reported_username}
                    </p>
                    <p className="text-sm whitespace-pre-wrap">{r.reason}</p>
                    {r.status === "open" && (
                      <div className="flex gap-2 pt-1">
                        <Button size="sm" variant="outline" onClick={() => resolveReport(r.id, "resolved")}>علامت‌گذاری به‌عنوان حل‌شده</Button>
                        <Button size="sm" variant="ghost" onClick={() => resolveReport(r.id, "dismissed")}>رد گزارش</Button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          </TabsContent>

          <TabsContent value="broadcast" className="mt-3">
            <BroadcastCard onSent={() => qc.invalidateQueries({ queryKey: ["admin-recent-messages"] })} />
          </TabsContent>

          <TabsContent value="controls" className="mt-3">
            <Card className="p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Lock className="w-4 h-4 text-primary" />
                <h3 className="font-semibold text-sm">قفل‌های همگانی (برای تمام کاربران)</h3>
              </div>
              <p className="text-xs text-muted-foreground">
                با فعال‌سازی هر گزینه، آن نوع پیام برای همه کاربران غیرفعال می‌شود.
              </p>
              <div className="space-y-2 pt-2">
                {([
                  ["text", "متن"],
                  ["voice", "پیام صوتی"],
                  ["image", "عکس"],
                  ["video", "ویدیو"],
                  ["file", "فایل"],
                ] as Array<[keyof GlobalLocks, string]>).map(([k, label]) => (
                  <div key={k} className="flex items-center justify-between border rounded-lg px-3 py-2">
                    <span className="text-sm">{label}</span>
                    <Switch
                      checked={!!globalLocks?.[k]}
                      onCheckedChange={(v) => setGlobalLock(k, v)}
                    />
                  </div>
                ))}
              </div>
            </Card>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

function StatCard({ icon, label, value, highlight }: { icon: React.ReactNode; label: string; value: number | undefined; highlight?: boolean }) {
  return (
    <Card className="p-3">
      <div className="flex items-center gap-2">
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${highlight ? "bg-primary text-primary-foreground" : "bg-primary/15 text-primary"}`}>
          {icon}
        </div>
        <div className="min-w-0">
          <p className="text-[10px] text-muted-foreground truncate">{label}</p>
          <p className="text-xl font-bold">{value ?? "—"}</p>
        </div>
      </div>
    </Card>
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
      <Button size="sm" variant="outline" onClick={() => onSuspend(user, null)} title="رفع تعلیق">
        <ShieldOff className="w-4 h-4" />
      </Button>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" title="تعلیق"><Ban className="w-4 h-4" /></Button>
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

function UserMoreMenu({
  user, onSetFlags, onDelete,
}: {
  user: AdminProfile;
  onSetFlags: (u: AdminProfile, flags: Partial<AdminProfile>) => void;
  onDelete: (u: AdminProfile) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline"><MoreVertical className="w-4 h-4" /></Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-2 space-y-1.5" align="end">
        <button
          onClick={() => onSetFlags(user, { is_scammer: !user.is_scammer })}
          className="w-full text-right flex items-center justify-between gap-2 px-3 py-2 rounded hover:bg-accent text-sm"
        >
          <span className="flex items-center gap-2"><ShieldAlert className="w-4 h-4 text-destructive" /> تگ کلاهبردار</span>
          <span className={`text-[10px] ${user.is_scammer ? "text-destructive" : "text-muted-foreground"}`}>{user.is_scammer ? "فعال" : "غیرفعال"}</span>
        </button>
        <div className="border-t pt-1.5 mt-1.5">
          <p className="text-[10px] text-muted-foreground px-3 py-1">قفل ارسال برای این کاربر</p>
          {([
            ["lock_text", "متن"],
            ["lock_voice", "صدا"],
            ["lock_image", "عکس"],
            ["lock_video", "ویدیو"],
            ["lock_file", "فایل"],
          ] as Array<[keyof AdminProfile, string]>).map(([k, label]) => (
            <div key={k} className="flex items-center justify-between px-3 py-1.5">
              <span className="text-sm">{label}</span>
              <Switch
                checked={!!user[k]}
                onCheckedChange={(v) => onSetFlags(user, { [k]: v } as Partial<AdminProfile>)}
              />
            </div>
          ))}
        </div>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <button className="w-full text-right flex items-center gap-2 px-3 py-2 rounded hover:bg-destructive/10 text-sm text-destructive border-t mt-1.5 pt-2.5">
              <Trash2 className="w-4 h-4" /> حذف حساب کاربری
            </button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>حذف کامل حساب؟</AlertDialogTitle>
              <AlertDialogDescription>
                با این کار حساب «{user.display_name || user.username}» به‌طور دائم حذف خواهد شد. این عمل قابل بازگشت نیست.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>انصراف</AlertDialogCancel>
              <AlertDialogAction onClick={() => { onDelete(user); setOpen(false); }} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                حذف
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </PopoverContent>
    </Popover>
  );
}

function BroadcastCard({ onSent }: { onSent: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const send = async () => {
    if (!text.trim()) { toast.error("متن خالی است"); return; }
    if (text.length > 2000) { toast.error("حداکثر ۲۰۰۰ کاراکتر"); return; }
    setBusy(true);
    const { data, error } = await supabase.rpc("admin_broadcast", { message: text.trim() });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`اعلان برای ${data} کاربر ارسال شد`);
    setText("");
    onSent();
  };

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Megaphone className="w-4 h-4 text-primary" />
        <h3 className="font-semibold text-sm">ارسال اعلان همگانی</h3>
      </div>
      <p className="text-xs text-muted-foreground">
        پیام شما به صورت یک اطلاعیه رسمی برای همه کاربران در چت‌هایشان ظاهر می‌شود.
      </p>
      <Textarea
        value={text} onChange={(e) => setText(e.target.value)}
        placeholder="متن اعلان..." rows={5} maxLength={2000}
      />
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground">{text.length}/2000</span>
        <Button onClick={send} disabled={busy}>
          {busy ? "..." : "ارسال به همه"}
        </Button>
      </div>
    </Card>
  );
}
