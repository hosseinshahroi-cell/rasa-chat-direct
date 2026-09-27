import { supabase } from "@/integrations/supabase/client";

const KEY = "rasa-outbox";
type Item = {
  sender_id: string; receiver_id: string; content: string | null;
  attachment_url: string | null; attachment_type: string | null; reply_to_id: string | null;
};

function read(): Item[] {
  try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { return []; }
}
function write(items: Item[]) {
  try { localStorage.setItem(KEY, JSON.stringify(items)); } catch { /* quota */ }
}

export function queueOutgoing(item: Item) { write([...read(), item]); }

let flushing = false;
export async function flushOutbox(onDone?: () => void) {
  if (flushing || !navigator.onLine) return;
  const items = read();
  if (!items.length) return;
  flushing = true;
  const left: Item[] = [];
  for (const it of items) {
    const { error } = await supabase.from("messages").insert(it);
    if (error && /fetch|network/i.test(error.message)) left.push(it);
  }
  write(left);
  flushing = false;
  onDone?.();
}
