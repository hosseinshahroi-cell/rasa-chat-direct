import { supabase } from "@/integrations/supabase/client";

const TTL_MS = 1000 * 60 * 50; // signed urls live 1h, refresh a bit earlier
const STORE_KEY = "rasa-avatar-urls";

type Entry = { url: string; exp: number };

const mem = new Map<string, Entry>();
let loaded = false;

function loadStore() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, Entry>;
    const now = Date.now();
    for (const [k, v] of Object.entries(parsed)) {
      if (v && v.exp > now) mem.set(k, v);
    }
  } catch { /* ignore */ }
}

let flushTimer: ReturnType<typeof setTimeout> | null = null;
function persist() {
  if (typeof window === "undefined") return;
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    try {
      window.localStorage.setItem(STORE_KEY, JSON.stringify(Object.fromEntries(mem)));
    } catch { /* quota */ }
  }, 300);
}

/** Synchronous read — returns a usable URL immediately when we already have one. */
export function getAvatarUrlSync(path: string | null | undefined): string | null {
  if (!path) return null;
  if (path.startsWith("http")) return path;
  loadStore();
  const hit = mem.get(path);
  return hit && hit.exp > Date.now() ? hit.url : null;
}

const inflight = new Map<string, Promise<string | null>>();

export async function getAvatarUrl(path: string | null | undefined): Promise<string | null> {
  if (!path) return null;
  if (path.startsWith("http")) return path;
  const cached = getAvatarUrlSync(path);
  if (cached) return cached;
  const running = inflight.get(path);
  if (running) return running;
  const p = (async () => {
    const { data } = await supabase.storage.from("avatars").createSignedUrl(path, 60 * 60);
    inflight.delete(path);
    if (!data?.signedUrl) return null;
    mem.set(path, { url: data.signedUrl, exp: Date.now() + TTL_MS });
    persist();
    return data.signedUrl;
  })();
  inflight.set(path, p);
  return p;
}

/** Batch-sign and warm the browser image cache for a list of avatar paths. */
export async function preloadAvatars(paths: (string | null | undefined)[]) {
  const missing = Array.from(
    new Set(
      paths.filter((p): p is string => !!p && !p.startsWith("http") && !getAvatarUrlSync(p)),
    ),
  );
  if (missing.length === 0) return;
  const { data } = await supabase.storage.from("avatars").createSignedUrls(missing, 60 * 60);
  const now = Date.now();
  for (const item of data ?? []) {
    if (item.signedUrl && item.path) {
      mem.set(item.path, { url: item.signedUrl, exp: now + TTL_MS });
      if (typeof Image !== "undefined") {
        const img = new Image();
        img.decoding = "async";
        img.src = item.signedUrl;
      }
    }
  }
  persist();
}
