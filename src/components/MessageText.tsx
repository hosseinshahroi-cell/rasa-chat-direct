import { Link } from "@tanstack/react-router";

const MENTION_RE = /(@[a-zA-Z0-9_]{3,30})/g;

export function MessageText({ text, mine }: { text: string; mine?: boolean }) {
  const parts = text.split(MENTION_RE);
  return (
    <p className="whitespace-pre-wrap break-words text-sm">
      {parts.map((p, i) => {
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
        return <span key={i}>{p}</span>;
      })}
    </p>
  );
}
