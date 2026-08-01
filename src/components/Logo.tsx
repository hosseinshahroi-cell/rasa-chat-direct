import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import defaultLogo from "@/assets/rasa-logo.png.asset.json";
import { supabase } from "@/integrations/supabase/client";

export interface Branding {
  app_name: string;
  logo_url: string;
}

const META_KEY = "rasa-branding";
const DATA_KEY = "rasa-branding-logo-data";

function readCachedBranding(): Branding | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(META_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<Branding>;
    if (!v.logo_url) return null;
    return { app_name: v.app_name || "رسا", logo_url: v.logo_url };
  } catch {
    return null;
  }
}

/** Logo bytes cached as a data URL so the correct logo paints on first frame. */
function readCachedLogoData(url: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(DATA_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as { url: string; data: string };
    return v.url === url ? v.data : null;
  } catch {
    return null;
  }
}

async function cacheLogoData(url: string) {
  if (typeof window === "undefined") return;
  if (readCachedLogoData(url)) return;
  try {
    const res = await fetch(url);
    if (!res.ok) return;
    const blob = await res.blob();
    if (blob.size > 900_000) return; // too big for localStorage
    const data = await new Promise<string>((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.onerror = reject;
      fr.readAsDataURL(blob);
    });
    window.localStorage.setItem(DATA_KEY, JSON.stringify({ url, data }));
  } catch {
    /* ignore */
  }
}

export function useBranding() {
  const cached = readCachedBranding();
  return useQuery<Branding>({
    queryKey: ["app-settings", "branding"],
    staleTime: 5 * 60_000,
    ...(cached ? { initialData: cached, initialDataUpdatedAt: 0 } : {}),
    queryFn: async () => {
      const { data } = await supabase
        .from("app_settings")
        .select("value")
        .eq("key", "branding")
        .maybeSingle();
      const v = (data?.value ?? {}) as Partial<Branding>;
      const branding: Branding = {
        app_name: v.app_name?.trim() || "رسا",
        logo_url: v.logo_url?.trim() || defaultLogo.url,
      };
      try {
        window.localStorage.setItem(META_KEY, JSON.stringify(branding));
      } catch { /* ignore */ }
      void cacheLogoData(branding.logo_url);
      return branding;
    },
  });
}

export function Logo({ size = 36, className = "" }: { size?: number; className?: string }) {
  const { data } = useBranding();
  const url = data?.logo_url || readCachedBranding()?.logo_url || defaultLogo.url;
  const src = readCachedLogoData(url) || url;
  const alt = data?.app_name || "رسا";

  useEffect(() => { void cacheLogoData(url); }, [url]);

  return (
    <img
      src={src}
      alt={alt}
      width={size}
      height={size}
      className={`rounded-xl object-cover ${className}`}
    />
  );
}
