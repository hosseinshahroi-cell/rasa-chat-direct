import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { checkUsernameAvailability } from "@/lib/username.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ArrowRight, Camera, Loader2, Check, Bell, BadgeCheck, Star, Languages } from "lucide-react";
import { toast } from "sonner";
import { getAvatarUrl } from "@/lib/avatar";
import { useLang, type Lang } from "@/lib/i18n";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({ meta: [{ title: "تنظیمات - رسا" }] }),
  component: SettingsPage,
});

function SettingsPage() {
  const navigate = useNavigate();
  const checkFn = useServerFn(checkUsernameAvailability);
  const [userId, setUserId] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [originalUsername, setOriginalUsername] = useState("");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [avatarPath, setAvatarPath] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [verified, setVerified] = useState(false);
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<{ available: boolean; error: string | null } | null>(null);
  const [saving, setSaving] = useState(false);
  const [notifGranted, setNotifGranted] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (typeof Notification !== "undefined") setNotifGranted(Notification.permission === "granted");
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return;
      setUserId(data.user.id);
      setEmail(data.user.email || "");
      const { data: p } = await supabase
        .from("profiles")
        .select("username, display_name, avatar_url, bio, is_verified")
        .eq("id", data.user.id).maybeSingle();
      if (p) {
        setUsername(p.username);
        setOriginalUsername(p.username);
        setDisplayName(p.display_name || "");
        setBio(p.bio || "");
        setAvatarPath(p.avatar_url);
        setVerified(p.is_verified);
        if (p.avatar_url) getAvatarUrl(p.avatar_url).then(setAvatarUrl);
      }
    });
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setCheckResult(null);
    if (!username || username === originalUsername) return;
    setChecking(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await checkFn({ data: { username, excludeUserId: userId ?? undefined } });
        setCheckResult(res);
      } finally { setChecking(false); }
    }, 450);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [username, originalUsername, userId, checkFn]);

  const onAvatar = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setAvatarFile(f);
    setAvatarUrl(URL.createObjectURL(f));
  };

  const requestNotif = async () => {
    if (!("Notification" in window)) return;
    const p = await Notification.requestPermission();
    setNotifGranted(p === "granted");
    if (p === "granted") toast.success("اعلان فعال شد");
  };

  const save = async () => {
    if (!userId) return;
    if (username !== originalUsername && !checkResult?.available) {
      toast.error("آیدی نامعتبر");
      return;
    }
    setSaving(true);
    try {
      let newPath = avatarPath;
      if (avatarFile) {
        const ext = avatarFile.name.split(".").pop() || "jpg";
        const path = `${userId}/avatar-${Date.now()}.${ext}`;
        const { error } = await supabase.storage.from("avatars").upload(path, avatarFile, { upsert: true });
        if (error) throw error;
        newPath = path;
      }
      const { error } = await supabase.from("profiles").update({
        username, display_name: displayName, bio: bio || null, avatar_url: newPath,
      }).eq("id", userId);
      if (error) throw error;
      toast.success("ذخیره شد");
      setOriginalUsername(username);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "خطا");
    } finally { setSaving(false); }
  };

  const logout = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/auth" });
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 bg-card/95 backdrop-blur border-b z-10">
        <div className="max-w-2xl mx-auto px-3 py-2.5 flex items-center gap-2">
          <Link to="/chats"><Button size="icon" variant="ghost"><ArrowRight className="w-5 h-5" /></Button></Link>
          <h2 className="font-semibold">تنظیمات</h2>
        </div>
      </header>
      <main className="max-w-2xl mx-auto p-4">
        <Card className="p-6 space-y-5">
          <div className="flex flex-col items-center gap-2">
            <button onClick={() => fileRef.current?.click()} className="relative group">
              <Avatar className="w-24 h-24 ring-2 ring-primary/20">
                {avatarUrl && <AvatarImage src={avatarUrl} />}
                <AvatarFallback className="bg-primary/10"><Camera className="w-8 h-8 text-primary" /></AvatarFallback>
              </Avatar>
              {verified && <BadgeCheck className="absolute -bottom-1 -left-1 w-6 h-6 text-primary fill-primary stroke-background" />}
            </button>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onAvatar} />
            <p className="text-xs text-muted-foreground" dir="ltr">{email}</p>
          </div>

          <div className="space-y-2">
            <Label>نام نمایشی</Label>
            <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={50} />
          </div>
          <div className="space-y-2">
            <Label>آیدی</Label>
            <div className="relative">
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">@</span>
              <Input value={username} onChange={(e) => setUsername(e.target.value.replace(/\s/g, ""))} className="pr-7" dir="ltr" maxLength={30} />
            </div>
            {username && username !== originalUsername && (
              <p className={`text-xs flex items-center gap-1 ${checking ? "text-muted-foreground" : checkResult?.available ? "text-[color:var(--color-success)]" : "text-destructive"}`}>
                {checking ? <><Loader2 className="w-3 h-3 animate-spin" /> در حال بررسی آیدی...</>
                  : checkResult?.available ? <><Check className="w-3 h-3" /> این آیدی در دسترس می‌باشد</>
                  : checkResult?.error}
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label>بیوگرافی</Label>
            <Input value={bio} onChange={(e) => setBio(e.target.value)} maxLength={150} />
          </div>

          <Button variant={notifGranted ? "secondary" : "outline"} className="w-full" onClick={requestNotif} disabled={notifGranted}>
            <Bell className="w-4 h-4 ml-2" />
            {notifGranted ? "اعلان‌ها فعال است" : "فعال کردن اعلان"}
          </Button>

          <Button onClick={save} className="w-full" disabled={saving}>
            {saving && <Loader2 className="w-4 h-4 ml-2 animate-spin" />}
            ذخیره تغییرات
          </Button>
        </Card>

        <LanguageCard />
        <RatingCard />

        <Card className="p-4">
          <Button variant="ghost" className="w-full text-destructive" onClick={logout}>خروج از حساب</Button>
        </Card>
      </main>
    </div>
  );
}

function LanguageCard() {
  const { lang, setLang } = useLang();
  const options: Array<{ id: Lang; label: string }> = [
    { id: "system", label: "زبان سیستم" },
    { id: "fa", label: "فارسی" },
    { id: "en", label: "English" },
  ];
  return (
    <Card className="p-4 space-y-3 mt-4">
      <div className="flex items-center gap-2">
        <Languages className="w-4 h-4 text-primary" />
        <h3 className="font-semibold text-sm">زبان برنامه</h3>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {options.map((o) => (
          <button
            key={o.id}
            onClick={() => setLang(o.id)}
            className={`text-sm rounded-lg border px-3 py-2 transition ${lang === o.id ? "border-primary bg-primary/10 text-primary font-medium" : "hover:bg-accent"}`}
          >{o.label}</button>
        ))}
      </div>
    </Card>
  );
}

function RatingCard() {
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return;
      const { data: r } = await supabase.from("app_ratings").select("stars, comment").eq("user_id", data.user.id).maybeSingle();
      if (r) { setStars(r.stars); setComment(r.comment || ""); setSubmitted(true); }
    });
  }, []);

  const submit = async () => {
    if (!stars) { toast.error("لطفاً ستاره انتخاب کنید"); return; }
    setBusy(true);
    const { error } = await supabase.rpc("rate_app", { p_stars: stars, p_comment: comment || undefined });
    setBusy(false);
    if (error) toast.error(error.message);
    else { toast.success("امتیاز شما ثبت شد"); setSubmitted(true); }
  };

  return (
    <Card className="p-4 space-y-3 mt-4">
      <div className="flex items-center gap-2">
        <Star className="w-4 h-4 text-primary" />
        <h3 className="font-semibold text-sm">امتیاز به رسا</h3>
      </div>
      <div className="flex justify-center gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} onClick={() => setStars(n)} className="transition hover:scale-110">
            <Star className={`w-8 h-8 ${n <= stars ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground"}`} />
          </button>
        ))}
      </div>
      <Textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="نظر شما (اختیاری)..." maxLength={500} rows={3} />
      <Button onClick={submit} disabled={busy} className="w-full">
        {busy && <Loader2 className="w-4 h-4 ml-2 animate-spin" />}
        {submitted ? "به‌روزرسانی امتیاز" : "ثبت امتیاز"}
      </Button>
    </Card>
  );
}
