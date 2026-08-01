import localforage from "localforage";
import { QueryClient } from "@tanstack/react-query";
import { persistQueryClient } from "@tanstack/react-query-persist-client";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";

let installed = false;

const UID_KEY = "rasa-uid";

export function getCachedUserId(): string | null {
  if (typeof window === "undefined") return null;
  try { return window.localStorage.getItem(UID_KEY); } catch { return null; }
}

export function setCachedUserId(id: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (id) window.localStorage.setItem(UID_KEY, id);
    else window.localStorage.removeItem(UID_KEY);
  } catch { /* ignore */ }
}

export function installQueryPersister(queryClient: QueryClient) {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const store = localforage.createInstance({
    name: "rasa-cache",
    storeName: "queries",
    description: "TanStack Query cache",
  });
  const persister = createAsyncStoragePersister({
    storage: {
      getItem: (k) => store.getItem<string>(k).then((v) => v ?? null),
      setItem: (k, v) => store.setItem(k, v).then(() => undefined),
      removeItem: (k) => store.removeItem(k),
    },
    key: "rasa-query-cache-v1",
    throttleTime: 800,
  });
  persistQueryClient({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    queryClient: queryClient as any,
    persister,
    maxAge: 1000 * 60 * 60 * 24 * 7,
    dehydrateOptions: {
      shouldDehydrateQuery: (q) => {
        const k = q.queryKey?.[0];
        return (
          k === "chats" ||
          k === "messages" ||
          k === "profile" ||
          k === "stories" ||
          k === "my-groups" ||
          k === "reactions"
        );
      },
    },
  });
}


/* ---------- synchronous snapshots (instant paint before IndexedDB rehydrates) ---------- */

const SNAP_PREFIX = "rasa-snap:";

export function readSnapshot<T>(key: string): T | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = window.localStorage.getItem(SNAP_PREFIX + key);
    if (!raw) return undefined;
    return JSON.parse(raw) as T;
  } catch { return undefined; }
}

export function writeSnapshot(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  try {
    const raw = JSON.stringify(value);
    if (raw.length > 1_500_000) return;
    window.localStorage.setItem(SNAP_PREFIX + key, raw);
  } catch { /* quota */ }
}

/* ---------- per-chat local flags (mute / hide) ---------- */

const MUTED_KEY = "rasa-muted-chats";
const HIDDEN_KEY = "rasa-hidden-chats";

function readSet(key: string): string[] {
  if (typeof window === "undefined") return [];
  try { return JSON.parse(window.localStorage.getItem(key) || "[]") as string[]; }
  catch { return []; }
}

function writeSet(key: string, ids: string[]) {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(key, JSON.stringify(Array.from(new Set(ids)))); }
  catch { /* ignore */ }
}

export const getMutedChats = () => readSet(MUTED_KEY);
export const isChatMuted = (id: string) => readSet(MUTED_KEY).includes(id);
export function setChatMuted(ids: string[], muted: boolean) {
  const cur = readSet(MUTED_KEY);
  writeSet(MUTED_KEY, muted ? [...cur, ...ids] : cur.filter((i) => !ids.includes(i)));
}

export const getHiddenChats = () => readSet(HIDDEN_KEY);
export function hideChats(ids: string[]) {
  writeSet(HIDDEN_KEY, [...readSet(HIDDEN_KEY), ...ids]);
}
export function unhideChats(ids: string[]) {
  writeSet(HIDDEN_KEY, readSet(HIDDEN_KEY).filter((i) => !ids.includes(i)));
}
