import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

const KEY = "rasa-perms-asked";

export function PermissionPrompt() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (localStorage.getItem(KEY)) return;
    setShow(true);
  }, []);

  const ask = async () => {
    localStorage.setItem(KEY, "1");
    setShow(false);
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      s.getTracks().forEach((t) => t.stop());
    } catch { /* denied */ }
    try {
      if ("Notification" in window && Notification.permission === "default") {
        await Notification.requestPermission();
      }
    } catch { /* noop */ }
  };

  if (!show) return null;
  return (
    <div className="fixed inset-0 z-[100] bg-background/80 backdrop-blur flex items-center justify-center p-6" dir="rtl">
      <div className="bg-card border rounded-2xl p-6 max-w-sm w-full space-y-4 text-center shadow-lg">
        <h2 className="text-lg font-bold">دسترسی‌های لازم</h2>
        <p className="text-sm text-muted-foreground">
          برای تماس صوتی و تصویری و دریافت اعلان پیام‌ها، اجازه دسترسی به میکروفون، دوربین و اعلان‌ها را بدهید.
        </p>
        <Button className="w-full" onClick={ask}>اجازه دادن</Button>
        <button className="text-xs text-muted-foreground" onClick={() => { localStorage.setItem(KEY, "1"); setShow(false); }}>
          بعداً
        </button>
      </div>
    </div>
  );
}
