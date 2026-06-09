import logo from "@/assets/rasa-logo.png.asset.json";

export function Logo({ size = 36, className = "" }: { size?: number; className?: string }) {
  return (
    <img
      src={logo.url}
      alt="رسا"
      width={size}
      height={size}
      className={`rounded-xl object-cover ${className}`}
    />
  );
}
