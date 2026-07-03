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
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffSec = Math.max(0, Math.floor(diffMs / 1000));
  if (diffSec < 60) return "آنلاین";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} دقیقه پیش آنلاین بود`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH} ساعت پیش آنلاین بود`;
  const diffD = Math.floor(diffH / 24);
  return `${diffD} روز پیش آنلاین بود`;
}
