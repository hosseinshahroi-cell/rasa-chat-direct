import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Heart, Eye, Trash2, Volume2, VolumeX, X, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { UserAvatar } from "@/components/UserAvatar";
import { StoryProgressBar } from "@/components/StoryProgressBar";
import { formatRelativeTime } from "@/lib/format";

export interface StoryMedia {
  id: string;
  user_id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  media_url: string;
  media_type: "image" | "video";
  caption: string | null;
  created_at: string;
  view_count: number;
  like_count: number;
  liked_by_me: boolean;
}

interface Props {
  stories: StoryMedia[];
  initialIndex?: number;
  me: string | null;
  onClose: () => void;
  onView?: (story: StoryMedia) => void;
  onLike?: (story: StoryMedia) => void;
  onDelete?: (story: StoryMedia) => void;
  onOpenViewers?: (story: StoryMedia) => void;
}

const IMAGE_DURATION_MS = 5000;
const LONG_PRESS_MS = 220;

export function StoryPlayer({
  stories, initialIndex = 0, me, onClose, onView, onLike, onDelete, onOpenViewers,
}: Props) {
  const [index, setIndex] = useState(initialIndex);
  const [progress, setProgress] = useState(0);
  const [muted, setMuted] = useState(true);
  const [paused, setPaused] = useState(false);
  const [urls, setUrls] = useState<Record<string, string>>({});

  const videoRef = useRef<HTMLVideoElement>(null);
  const rafRef = useRef<number | null>(null);
  const imageStart = useRef(0);
  const imageElapsed = useRef(0);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressed = useRef(false);

  const story = stories[index];
  const src = story ? urls[story.id] : undefined;

  const goNext = useCallback(() => {
    setProgress(0);
    imageElapsed.current = 0;
    setIndex((i) => {
      if (i + 1 >= stories.length) { onClose(); return i; }
      return i + 1;
    });
  }, [stories.length, onClose]);

  const goPrev = useCallback(() => {
    setProgress(0);
    imageElapsed.current = 0;
    setIndex((i) => Math.max(0, i - 1));
  }, []);

  // sign current + next media
  useEffect(() => {
    let alive = true;
    const needed = [stories[index], stories[index + 1]].filter(Boolean) as StoryMedia[];
    const missing = needed.filter((s) => !urls[s.id]);
    if (missing.length === 0) return;
    supabase.storage
      .from("chat-attachments")
      .createSignedUrls(missing.map((s) => s.media_url), 60 * 20)
      .then(({ data }) => {
        if (!alive || !data) return;
        setUrls((prev) => {
          const next = { ...prev };
          data.forEach((d, i) => { if (d.signedUrl) next[missing[i].id] = d.signedUrl; });
          return next;
        });
      });
    return () => { alive = false; };
  }, [index, stories, urls]);

  // mark viewed
  useEffect(() => {
    if (story && me && story.user_id !== me) onView?.(story);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [story?.id, me]);

  // progress driver
  useEffect(() => {
    if (!story || !src) return;
    let cancelled = false;

    const tick = () => {
      if (cancelled) return;
      if (story.media_type === "video") {
        const v = videoRef.current;
        if (v && v.duration > 0) setProgress(v.currentTime / v.duration);
      } else if (!paused) {
        const elapsed = imageElapsed.current + (Date.now() - imageStart.current);
        const p = elapsed / IMAGE_DURATION_MS;
        setProgress(p);
        if (p >= 1) { goNext(); return; }
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    if (story.media_type === "image" && !paused) imageStart.current = Date.now();
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [story, src, paused, goNext]);

  // play/pause video on state change
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (paused) v.pause();
    else void v.play().catch(() => {});
  }, [paused, src, index]);

  // keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") goPrev();
      if (e.key === "ArrowLeft") goNext();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, goNext, goPrev]);

  const beginPress = () => {
    longPressed.current = false;
    pressTimer.current = setTimeout(() => {
      longPressed.current = true;
      if (story?.media_type === "image") {
        imageElapsed.current += Date.now() - imageStart.current;
      }
      setPaused(true);
    }, LONG_PRESS_MS);
  };

  const endPress = (e: React.PointerEvent<HTMLDivElement>) => {
    if (pressTimer.current) { clearTimeout(pressTimer.current); pressTimer.current = null; }
    if (longPressed.current) {
      longPressed.current = false;
      if (story?.media_type === "image") imageStart.current = Date.now();
      setPaused(false);
      return;
    }
    // simple tap → navigate (right half = next, left half = previous)
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    if (x > rect.width / 2) goNext();
    else goPrev();
  };

  if (!story) return null;

  const body = (
    <div className="fixed inset-0 z-[100] bg-black select-none" dir="rtl">
      {/* media */}
      {!src && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-white/80" />
        </div>
      )}
      {src && story.media_type === "video" && (
        <video
          key={story.id}
          ref={videoRef}
          src={src}
          autoPlay
          muted={muted}
          playsInline
          preload="auto"
          disablePictureInPicture
          onEnded={goNext}
          className="absolute inset-0 w-full h-full object-cover"
        />
      )}
      {src && story.media_type === "image" && (
        <img src={src} alt="استوری" className="absolute inset-0 w-full h-full object-cover" />
      )}

      {/* gesture layer */}
      <div
        className="absolute inset-0"
        onPointerDown={beginPress}
        onPointerUp={endPress}
        onPointerCancel={() => {
          if (pressTimer.current) clearTimeout(pressTimer.current);
          longPressed.current = false;
          setPaused(false);
        }}
        onContextMenu={(e) => e.preventDefault()}
      />

      {/* top: progress + header */}
      <div className="absolute top-0 inset-x-0 p-3 pt-[max(0.75rem,env(safe-area-inset-top))] bg-gradient-to-b from-black/70 to-transparent pointer-events-none">
        <StoryProgressBar count={stories.length} current={index} progress={progress} />
        <div className="flex items-center gap-2 mt-3 text-white pointer-events-auto">
          <UserAvatar avatarPath={story.avatar_url} name={story.display_name || story.username} className="w-9 h-9" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold truncate">{story.display_name || story.username}</p>
            <p className="text-[11px] opacity-80">{formatRelativeTime(story.created_at)}</p>
          </div>
          {story.media_type === "video" && (
            <button
              onClick={() => setMuted((m) => !m)}
              aria-label={muted ? "روشن کردن صدا" : "بی‌صدا"}
              className="h-9 w-9 rounded-full bg-white/15 backdrop-blur flex items-center justify-center"
            >
              {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </button>
          )}
          {story.user_id === me && onDelete && (
            <button
              onClick={() => onDelete(story)}
              aria-label="حذف استوری"
              className="h-9 w-9 rounded-full bg-destructive/80 flex items-center justify-center"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={onClose}
            aria-label="بستن"
            className="h-9 w-9 rounded-full bg-white/15 backdrop-blur flex items-center justify-center"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* bottom actions */}
      <div className="absolute bottom-0 inset-x-0 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-6 bg-gradient-to-t from-black/85 to-transparent text-white">
        {story.caption && <p className="text-sm mb-2 line-clamp-3">{story.caption}</p>}
        <div className="flex items-center gap-3">
          {story.user_id === me ? (
            <button onClick={() => onOpenViewers?.(story)} className="flex items-center gap-3 text-sm">
              <span className="inline-flex items-center gap-1"><Eye className="w-4 h-4" /> {story.view_count} بازدید</span>
              <span className="inline-flex items-center gap-1"><Heart className="w-4 h-4 fill-red-500 text-red-500" /> {story.like_count}</span>
            </button>
          ) : (
            <>
              <button onClick={() => onLike?.(story)} className="inline-flex items-center gap-1.5 text-sm" aria-label="لایک">
                <Heart className={`w-6 h-6 transition ${story.liked_by_me ? "fill-red-500 text-red-500 scale-110" : "text-white"}`} />
                {story.like_count > 0 && <span>{story.like_count}</span>}
              </button>
              <span className="mr-auto inline-flex items-center gap-1 text-xs opacity-80">
                <Eye className="w-3.5 h-3.5" /> {story.view_count}
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(body, document.body);
}
