import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MoreVertical, Download, X } from "lucide-react";

export interface MediaItem {
  url: string;
  name: string;
  type: "image" | "video";
}

interface Props {
  items: MediaItem[];
  initialIndex?: number;
  onClose: () => void;
  onDownload: (url: string, name: string) => void;
}

export function MediaViewer({ items, initialIndex = 0, onClose, onDownload }: Props) {
  const [index, setIndex] = useState(initialIndex);
  const [drag, setDrag] = useState(0);
  const [menu, setMenu] = useState(false);
  const startX = useRef<number | null>(null);
  const moved = useRef(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") setIndex((i) => Math.min(items.length - 1, i + 1));
      if (e.key === "ArrowRight") setIndex((i) => Math.max(0, i - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [items.length, onClose]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  const current = items[index];
  if (!current) return null;

  const onDown = (e: React.PointerEvent) => {
    startX.current = e.clientX;
    moved.current = false;
  };
  const onMove = (e: React.PointerEvent) => {
    if (startX.current === null) return;
    const dx = e.clientX - startX.current;
    if (Math.abs(dx) > 6) moved.current = true;
    setDrag(dx);
  };
  const onUp = () => {
    if (startX.current === null) return;
    const dx = drag;
    startX.current = null;
    setDrag(0);
    const threshold = Math.min(90, window.innerWidth * 0.18);
    if (dx <= -threshold) setIndex((i) => Math.min(items.length - 1, i + 1));
    else if (dx >= threshold) setIndex((i) => Math.max(0, i - 1));
  };

  const body = (
    <div className="fixed inset-0 z-[120] bg-black select-none" dir="rtl">
      {/* slider */}
      <div
        className="absolute inset-0 flex touch-pan-y"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        style={{
          transform: `translateX(${-index * 100}%) translateX(${drag}px)`,
          transition: drag ? "none" : "transform 220ms ease-out",
          width: `${items.length * 100}%`,
          flexDirection: "row-reverse",
        }}
      >
        {items.map((it, i) => (
          <div key={`${it.url}-${i}`} className="w-full h-full shrink-0 flex items-center justify-center" style={{ width: `${100 / items.length}%` }}>
            {it.type === "video" ? (
              <video
                src={it.url}
                controls
                playsInline
                preload="metadata"
                autoPlay={i === index}
                className="max-w-full max-h-full"
                onPointerDown={(e) => e.stopPropagation()}
              />
            ) : (
              <img src={it.url} alt={it.name} draggable={false} className="max-w-full max-h-full object-contain" />
            )}
          </div>
        ))}
      </div>

      {/* top bar: only close + three-dot menu */}
      <div className="absolute top-0 inset-x-0 flex items-center justify-between p-3 pt-[max(0.75rem,env(safe-area-inset-top))] bg-gradient-to-b from-black/60 to-transparent">
        <button
          onClick={onClose}
          aria-label="بستن"
          className="h-10 w-10 rounded-full bg-white/10 backdrop-blur text-white flex items-center justify-center"
        >
          <X className="w-5 h-5" />
        </button>
        <div className="relative">
          <button
            onClick={() => setMenu((m) => !m)}
            aria-label="گزینه‌ها"
            className="h-10 w-10 rounded-full bg-white/10 backdrop-blur text-white flex items-center justify-center"
          >
            <MoreVertical className="w-5 h-5" />
          </button>
          {menu && (
            <>
              <div className="fixed inset-0 z-[1]" onClick={() => setMenu(false)} />
              <div className="absolute left-0 mt-2 z-[2] min-w-32 rounded-xl bg-card shadow-lg border overflow-hidden">
                <button
                  onClick={() => { setMenu(false); onDownload(current.url, current.name); }}
                  className="w-full flex items-center gap-2 px-4 py-3 text-sm hover:bg-accent"
                >
                  <Download className="w-4 h-4" /> دانلود
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {items.length > 1 && (
        <div className="absolute bottom-[max(1rem,env(safe-area-inset-bottom))] inset-x-0 flex justify-center gap-1.5">
          {items.map((_, i) => (
            <span key={i} className={`h-1.5 rounded-full transition-all ${i === index ? "w-5 bg-white" : "w-1.5 bg-white/40"}`} />
          ))}
        </div>
      )}
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(body, document.body);
}
