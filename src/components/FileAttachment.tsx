import { useState } from "react";
import { Download, FileText, Check, Loader2 } from "lucide-react";

function humanSize(n: number) {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function FileAttachment({ src, name, mine }: { src: string; name: string; mine: boolean }) {
  const [progress, setProgress] = useState(0);
  const [state, setState] = useState<"idle" | "loading" | "done">("idle");
  const [size, setSize] = useState<number>(0);

  const download = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (state === "loading") return;
    setState("loading");
    setProgress(0);
    try {
      const res = await fetch(src);
      if (!res.ok || !res.body) throw new Error("network");
      const total = Number(res.headers.get("content-length") || 0);
      setSize(total);
      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      let received = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        if (total) setProgress(Math.round((received / total) * 100));
      }
      const blob = new Blob(chunks as BlobPart[]);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 500);
      setProgress(100);
      setState("done");
    } catch {
      setState("idle");
    }
  };

  const ring = 48;
  const stroke = 3;
  const r = (ring - stroke) / 2;
  const c = 2 * Math.PI * r;
  const off = c - (progress / 100) * c;

  const fg = mine ? "text-white" : "text-primary";
  const bgBtn = mine ? "bg-white text-primary" : "bg-primary text-primary-foreground";

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={(e) => { e.stopPropagation(); download(e); }}
      className={`flex items-center gap-2.5 min-w-[220px] py-1 text-right cursor-pointer select-none ${mine ? "text-white" : "text-foreground"}`}
    >
      <div className="relative w-12 h-12 shrink-0">
        {state === "loading" && (
          <svg className="absolute inset-0 -rotate-90" width={ring} height={ring}>
            <circle cx={ring / 2} cy={ring / 2} r={r} strokeWidth={stroke} className={mine ? "stroke-white/30" : "stroke-primary/25"} fill="none" />
            <circle
              cx={ring / 2} cy={ring / 2} r={r} strokeWidth={stroke}
              className={mine ? "stroke-white" : "stroke-primary"} fill="none"
              strokeDasharray={c} strokeDashoffset={off} strokeLinecap="round"
              style={{ transition: "stroke-dashoffset 120ms linear" }}
            />
          </svg>
        )}
        <span className={`absolute inset-1 rounded-full flex items-center justify-center ${bgBtn}`}>
          {state === "loading" ? (
            progress > 0 ? <span className="text-[10px] font-bold">{progress}%</span> : <Loader2 className="w-4 h-4 animate-spin" />
          ) : state === "done" ? (
            <Check className="w-5 h-5" />
          ) : (
            <Download className="w-5 h-5" />
          )}
        </span>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate flex items-center gap-1" dir="ltr">
          <FileText className={`w-3.5 h-3.5 ${fg} shrink-0`} /> {name}
        </p>
        <p className={`text-[11px] ${mine ? "text-white/70" : "text-muted-foreground"}`}>
          {state === "loading" ? `در حال دانلود ${progress}%` : state === "done" ? "دانلود شد" : (size ? humanSize(size) : "برای دانلود ضربه بزنید")}
        </p>
      </div>
    </button>
  );
}
