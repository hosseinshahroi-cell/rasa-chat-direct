import { Link } from "@tanstack/react-router";

const MENTION_RE = /(@[a-zA-Z0-9_]{3,30})/g;
// splitting regex: URLs OR mentions
const TOKEN_RE = /((?:https?:\/\/|www\.)[^\s<>()]+[^\s<>().,،؟!?:;]|@[a-zA-Z0-9_]{3,30})/g;

function normalizeUrl(u: string) {
  return u.startsWith("http") ? u : `https://${u}`;
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
