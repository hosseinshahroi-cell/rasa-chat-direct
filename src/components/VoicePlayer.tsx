import { useEffect, useRef, useState } from "react";
import { Play, Pause, Download } from "lucide-react";

export function VoicePlayer({ src, mine }: { src: string; mine: boolean }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [current, setCurrent] = useState(0);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onMeta = () => setDuration(a.duration || 0);
    const onTime = () => {
      setCurrent(a.currentTime);
      setProgress(a.duration ? (a.currentTime / a.duration) * 100 : 0);
    };
    const onEnd = () => { setPlaying(false); setProgress(0); setCurrent(0); };
    a.addEventListener("loadedmetadata", onMeta);
    a.addEventListener("durationchange", onMeta);
    a.addEventListener("timeupdate", onTime);
    a.addEventListener("ended", onEnd);
    return () => {
      a.removeEventListener("loadedmetadata", onMeta);
      a.removeEventListener("durationchange", onMeta);
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("ended", onEnd);
    };
  }, [src]);

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (playing) { a.pause(); setPlaying(false); }
    else { a.play().then(() => setPlaying(true)).catch(() => {}); }
  };

  const fmt = (t: number) => {
    if (!isFinite(t)) return "0:00";
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60);
    return `${m}:${String(s).padStart(2, "0")}`;
  };

  const onSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const a = audioRef.current;
    if (!a || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const pct = x / rect.width;
    a.currentTime = pct * duration;
  };

  const fg = mine ? "bg-white" : "bg-primary";
  const bg = mine ? "bg-white/30" : "bg-primary/25";
  const accent = mine ? "text-white" : "text-primary-foreground";

  return (
    <div className="flex items-center gap-2.5 min-w-[200px] py-1">
      <audio ref={audioRef} src={src} preload="metadata" />
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); toggle(); }}
        className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${mine ? "bg-white text-primary" : "bg-primary text-primary-foreground"}`}
      >
        {playing ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current translate-x-[1px]" />}
      </button>
      <div className="flex-1 min-w-0">
        <div
          onClick={(e) => { e.stopPropagation(); onSeek(e); }}
          className={`h-1.5 rounded-full cursor-pointer ${bg} overflow-hidden`}
        >
          <div className={`h-full ${fg} rounded-full transition-all`} style={{ width: `${progress}%` }} />
        </div>
        <div className={`text-[10px] mt-1 ${mine ? "text-white/80" : "text-muted-foreground"}`}>
          {playing || current > 0 ? fmt(current) : fmt(duration)}
        </div>
      </div>
      <a
        href={src} download target="_blank" rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className={`opacity-70 hover:opacity-100 ${mine ? "text-white" : "text-foreground"}`}
        title="دانلود"
      >
        <Download className="w-4 h-4" />
      </a>
    </div>
  );
}
