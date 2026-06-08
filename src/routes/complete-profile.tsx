import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { checkUsernameAvailability } from "@/lib/username.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { toast } from "sonner";
import { Camera, Loader2, Bell, Check } from "lucide-react";

export const Route = createFileRoute("/complete-profile")({
  head: () => ({ meta: [{ title: "تکمیل پروفایل - رسا" }] }),
  component: CompleteProfilePage,
});

function CompleteProfilePage() {
  const navigate = useNavigate();
  const checkFn = useServerFn(checkUsernameAvailability);
  const [userId, setUserId] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [bio, setBio] = useState("");
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<{ available: boolean; error: string | null } | null>(null);
  const [saving, setSaving] = useState(false);
  const [notifGranted, setNotifGranted] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) {
        navigate({ to: "/auth" });
        return;
      }
      setUserId(data.user.id);
      if (typeof Notification !== "undefined") setNotifGranted(Notification.permission === "granted");
    });
  }, [navigate]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setCheckResult(null);
    if (!username) return;
    setChecking(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await checkFn({ data: { username, excludeUserId: userId ?? undefined } });
        setCheckResult(res);
      } catch {
        setCheckResult({ available: false, error: "خطا در بررسی" });
      } finally {
        setChecking(false);
      }
    }, 450);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [username, userId, checkFn]);

  const onAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) {
      toast.error("حجم عکس نباید بیشتر از ۵ مگابایت باشد");
      return;
    }
    setAvatarFile(f);
    setAvatarPreview(URL.createObjectURL(f));
  };

  const requestNotifications = async () => {
    if (!("Notification" in window)) {
      toast.error("مرورگر شما اعلان را پشتیبانی نمی‌کند");
      return;
    }
    const perm = await Notification.requestPermission();
    setNotifGranted(perm === "granted");
    if (perm === "granted") toast.success("اعلان‌ها فعال شد");
  };

  const handleSave = async () => {
    if (!userId) return;
    if (!checkResult?.available) {
      toast.error("لطفا یک آیدی معتبر و آزاد انتخاب کنید");
      return;
    }
    if (!displayName.trim()) {
      toast.error("نام نمایشی را وارد کنید");
      return;
    }
    setSaving(true);
    try {
      let avatar_url: string | null = null;
      if (avatarFile) {
        const ext = avatarFile.name.split(".").pop() || "jpg";
        const path = `${userId}/avatar-${Date.now()}.${ext}`;
        const { error: upErr } = await supabase.storage.from("avatars").upload(path, avatarFile, { upsert: true });
        if (upErr) throw upErr;
        avatar_url = path;
      }
      const { error } = await supabase
        .from("profiles")
        .update({
          username: username.trim(),
          display_name: displayName.trim(),
          bio: bio.trim() || null,
          ...(avatar_url ? { avatar_url } : {}),
        })
        .eq("id", userId);
      if (error) throw error;
      toast.success("پروفایل ذخیره شد");
      navigate({ to: "/chats" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "خطا در ذخیره");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/5 to-background p-4 flex items-center justify-center">
      <Card className="w-full max-w-md p-6 space-y-5">
        <div className="text-center space-y-1">
          <h1 className="text-2xl font-bold">تکمیل پروفایل</h1>
          <p className="text-sm text-muted-foreground">اطلاعاتت رو وارد کن تا شروع کنیم</p>
        </div>

        <div className="flex flex-col items-center gap-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="relative group"
          >
            <Avatar className="w-24 h-24 ring-2 ring-primary/20">
              {avatarPreview && <AvatarImage src={avatarPreview} />}
              <AvatarFallback className="bg-primary/10">
                <Camera className="w-8 h-8 text-primary" />
              </AvatarFallback>
            </Avatar>
            <span className="absolute inset-0 rounded-full bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition">
              <Camera className="w-6 h-6 text-white" />
            </span>
          </button>
          <input
            ref={fileInputRef} type="file" accept="image/*"
            className="hidden" onChange={onAvatarChange}
          />
          <p className="text-xs text-muted-foreground">عکس پروفایل (اختیاری)</p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="display_name">نام نمایشی</Label>
          <Input
            id="display_name" value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="مثلا: علی محمدی" maxLength={50}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="username">آیدی (نام کاربری)</Label>
          <div className="relative">
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">@</span>
            <Input
              id="username" value={username}
              onChange={(e) => setUsername(e.target.value.replace(/\s/g, ""))}
              placeholder="ali_mohammadi"
              className="pr-7" dir="ltr" maxLength={30}
            />
          </div>
          {username && (
            <p
              className={`text-xs flex items-center gap-1 ${
                checking
                  ? "text-muted-foreground"
                  : checkResult?.available
                  ? "text-[color:var(--color-success)]"
                  : "text-destructive"
              }`}
            >
              {checking ? (
                <><Loader2 className="w-3 h-3 animate-spin" /> در حال بررسی آیدی...</>
              ) : checkResult?.available ? (
                <><Check className="w-3 h-3" /> این آیدی در دسترس می‌باشد</>
              ) : checkResult?.error ? (
                <>{checkResult.error}</>
              ) : null}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="bio">بیوگرافی (اختیاری)</Label>
          <Input
            id="bio" value={bio} onChange={(e) => setBio(e.target.value)}
            placeholder="درباره من..." maxLength={150}
          />
        </div>

        <Button
          type="button"
          variant={notifGranted ? "secondary" : "outline"}
          className="w-full"
          onClick={requestNotifications}
          disabled={notifGranted}
        >
          <Bell className="w-4 h-4 ml-2" />
          {notifGranted ? "اعلان‌ها فعال است" : "فعال کردن اعلان"}
        </Button>

        <Button onClick={handleSave} className="w-full" disabled={saving || !checkResult?.available}>
          {saving && <Loader2 className="w-4 h-4 ml-2 animate-spin" />}
          ذخیره و ورود
        </Button>
      </Card>
    </div>
  );
}
