import { useEffect, useState } from "react";

export function OfflineBanner() {
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    const up = () => setOffline(!navigator.onLine);
    up();
    window.addEventListener("online", up);
    window.addEventListener("offline", up);
    return () => { window.removeEventListener("online", up); window.removeEventListener("offline", up); };
  }, []);
  if (!offline) return null;
  return (
    <div className="fixed top-0 inset-x-0 z-[90] bg-primary text-primary-foreground text-xs text-center py-1" dir="rtl">
      در انتظار شبکه… پیام‌های قبلی از حافظه گوشی نمایش داده می‌شوند
    </div>
  );
}
