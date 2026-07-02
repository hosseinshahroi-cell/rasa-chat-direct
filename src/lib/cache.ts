import localforage from "localforage";
import { QueryClient } from "@tanstack/react-query";
import { persistQueryClient } from "@tanstack/react-query-persist-client";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";

let installed = false;

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
    queryClient,
    persister,
    maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
    dehydrateOptions: {
      shouldDehydrateQuery: (q) => {
        const k = q.queryKey?.[0];
        // persist chats list, messages, profiles, groups, stories
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
