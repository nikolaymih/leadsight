import { Globe } from "lucide-react";
import { PLATFORM_LABEL } from "@/lib/format";
import type { Platform } from "@/lib/types";
import { cn } from "@/lib/utils";

// lucide ships no brand marks, so platforms get a compact monogram. Same size as an icon.
const GLYPH: Record<Exclude<Platform, "web">, string> = {
  reddit: "r/",
  linkedin: "in",
  x: "X",
  facebook: "f",
};

export function PlatformIcon({ platform, className }: { platform: Platform; className?: string }) {
  const label = PLATFORM_LABEL[platform] ?? platform;
  if (platform === "web") {
    return <Globe className={cn("size-4 text-muted-foreground", className)} aria-label={label} role="img" />;
  }
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex size-4 items-center justify-center rounded-[3px] bg-muted font-mono text-[9px] font-semibold text-muted-foreground",
        className,
      )}
    >
      {GLYPH[platform]}
    </span>
  );
}
