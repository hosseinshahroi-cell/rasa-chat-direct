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

