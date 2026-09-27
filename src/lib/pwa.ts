// Single guarded registrar for the offline service worker (/sw.js).
function isRefusedContext(): boolean {
  if (!import.meta.env.PROD) return true;
  try { if (window.self !== window.top) return true; } catch { return true; }
  const h = window.location.hostname;
  if (h.startsWith("id-preview--") || h.startsWith("preview--")) return true;
  const bad = ["lovableproject.com", "lovableproject-dev.com", "beta.lovable.dev"];
  if (bad.some((d) => h === d || h.endsWith("." + d))) return true;
  if (new URLSearchParams(window.location.search).get("sw") === "off") return true;
  return false;
}

async function unregisterAppSW() {
  const regs = await navigator.serviceWorker.getRegistrations();
  await Promise.all(
    regs
      .filter((r) => [r.active, r.waiting, r.installing].some((w) => w?.scriptURL.endsWith("/sw.js")))
      .map((r) => r.unregister()),
  );
}

export function registerOfflineSW() {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  if (isRefusedContext()) { void unregisterAppSW().catch(() => {}); return; }
  navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
}
