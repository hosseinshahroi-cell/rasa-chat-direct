import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useEffect, useState } from "react";
import { getAvatarUrl } from "@/lib/avatar";
import { BadgeCheck } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  avatarPath?: string | null;
  name?: string | null;
  verified?: boolean;
  className?: string;
  badgeClassName?: string;
}

export function UserAvatar({ avatarPath, name, verified, className, badgeClassName }: Props) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    getAvatarUrl(avatarPath).then((u) => {
      if (alive) setUrl(u);
    });
    return () => { alive = false; };
  }, [avatarPath]);

  const initials = (name || "?").trim().slice(0, 2).toUpperCase();
  return (
    <div className="relative inline-block">
      <Avatar className={cn("w-10 h-10", className)}>
        {url && <AvatarImage src={url} alt={name || ""} />}
        <AvatarFallback className="bg-primary/15 text-primary font-medium">{initials}</AvatarFallback>
      </Avatar>
      {verified && (
        <BadgeCheck className={cn("absolute -bottom-0.5 -left-0.5 w-4 h-4 text-primary fill-primary stroke-background", badgeClassName)} />
      )}
    </div>
  );
}
