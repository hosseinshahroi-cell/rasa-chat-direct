import { memo } from "react";

interface Props {
  /** total number of story segments */
  count: number;
  /** index of the currently playing segment */
  current: number;
  /** progress of the current segment, 0..1 */
  progress: number;
}

/** Instagram-style segmented progress bar. */
function StoryProgressBarBase({ count, current, progress }: Props) {
  return (
    <div className="flex items-center gap-1 w-full" dir="ltr">
      {Array.from({ length: count }).map((_, i) => {
        const value = i < current ? 1 : i === current ? Math.min(1, Math.max(0, progress)) : 0;
        return (
          <div key={i} className="h-0.5 flex-1 rounded-full bg-white/30 overflow-hidden">
            <div
              className="h-full bg-white rounded-full"
              style={{ width: `${value * 100}%`, transition: i === current ? "width 100ms linear" : "none" }}
            />
          </div>
        );
      })}
    </div>
  );
}

export const StoryProgressBar = memo(StoryProgressBarBase);
