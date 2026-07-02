export function formatRelativeTime(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "هم‌اکنون";
  if (diffMin < 60) return `${diffMin} دقیقه پیش`;
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) {
    return date.toLocaleTimeString("fa-IR", { hour: "2-digit", minute: "2-digit" });
  }
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return "دیروز";
  return date.toLocaleDateString("fa-IR", { month: "short", day: "numeric" });
}

export function formatChatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("fa-IR", { hour: "2-digit", minute: "2-digit" });
}

export function formatLastSeen(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  const diffMs = Date.now() - date.getTime();
  const diffSec = Math.max(0, Math.floor(diffMs / 1000));
  if (diffSec < 90) return "آنلاین";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 2) return "لحظاتی پیش آنلاین بود";
  if (diffMin < 60) return `${diffMin} دقیقه پیش آنلاین بود`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) {
    const today = new Date();
    const sameDay = date.toDateString() === today.toDateString();
    if (sameDay) return `امروز ساعت ${date.toLocaleTimeString("fa-IR", { hour: "2-digit", minute: "2-digit" })}`;
    return `${diffH} ساعت پیش آنلاین بود`;
  }
  const diffD = Math.floor(diffH / 24);
  if (diffD === 1) return `دیروز ساعت ${date.toLocaleTimeString("fa-IR", { hour: "2-digit", minute: "2-digit" })}`;
  if (diffD < 7) return `${diffD} روز پیش آنلاین بود`;
  return `آخرین بازدید: ${date.toLocaleDateString("fa-IR")}`;
}
