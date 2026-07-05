import { Link } from "@tanstack/react-router";

const MENTION_RE = /(@[a-zA-Z0-9_]{3,30})/g;
const TOKEN_RE = /((?:https?:\/\/|www\.)[^\s<>()]+[^\s<>().,،؟!?:;]|@[a-zA-Z0-9_]{3,30})/g;

function normalizeUrl(u: string) {
  return u.startsWith("http") ? u : `https://${u}`;
}

// Detect an in-app group-invite URL and return the token if it matches
function extractJoinToken(raw: string): string | null {
  try {
    const full = normalizeUrl(raw);
    const u = new URL(full);
    const here = typeof window !== "undefined" ? window.location.host : "";
    const isRasaHost =
      u.host === here ||
      /(^|\.)lovable\.app$/i.test(u.host) ||
      /rasa/i.test(u.host);
    if (!isRasaHost) return null;
    const m = u.pathname.match(/\/join\/([A-Za-z0-9]{6,})/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

export function MessageText({ text, mine }: { text: string; mine?: boolean }) {
  const parts = text.split(TOKEN_RE);
  return (
    <p className="whitespace-pre-wrap break-words text-sm">
      {parts.map((p, i) => {
        if (!p) return null;
        if (MENTION_RE.test(p)) {
          MENTION_RE.lastIndex = 0;
          const username = p.slice(1);
          return (
            <Link
              key={i}
              to="/u/$username"
              params={{ username }}
              onClick={(e) => e.stopPropagation()}
              className={`font-medium hover:underline ${mine ? "text-white" : "text-primary"}`}
              dir="ltr"
            >
              {p}
            </Link>
          );
        }
        if (/^(https?:\/\/|www\.)/i.test(p)) {
          const token = extractJoinToken(p);
          if (token) {
            return (
              <Link
                key={i}
                to="/join/$token"
                params={{ token }}
                onClick={(e) => e.stopPropagation()}
                className={`underline break-all font-medium ${mine ? "text-white" : "text-primary"}`}
                dir="ltr"
              >
                🔗 پیوستن به گروه
              </Link>
            );
          }
          return (
            <a
              key={i}
              href={normalizeUrl(p)}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className={`underline break-all ${mine ? "text-white" : "text-primary"}`}
              dir="ltr"
            >
              {p}
            </a>
          );
        }
        return <span key={i}>{p}</span>;
      })}
    </p>
  );
}
