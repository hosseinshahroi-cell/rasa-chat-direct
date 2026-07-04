import { useQuery } from "@tanstack/react-query";
import defaultLogo from "@/assets/rasa-logo.png.asset.json";
import { supabase } from "@/integrations/supabase/client";

export interface Branding {
  app_name: string;
  logo_url: string;
}

export function useBranding() {
  return useQuery<Branding>({
    queryKey: ["app-settings", "branding"],
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("app_settings")
        .select("value")
        .eq("key", "branding")
        .maybeSingle();
      const v = (data?.value ?? {}) as Partial<Branding>;
      return {
        app_name: v.app_name?.trim() || "رسا",
        logo_url: v.logo_url?.trim() || defaultLogo.url,
      };
    },
  });
}

export function Logo({ size = 36, className = "" }: { size?: number; className?: string }) {
  const { data } = useBranding();
  const src = data?.logo_url || defaultLogo.url;
  const alt = data?.app_name || "رسا";
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
