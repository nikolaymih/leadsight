import { Badge } from "@/components/ui/badge";
import type { Verdict } from "@/lib/types";
import { cn } from "@/lib/utils";

// The only consumer of the --verdict-* tokens (see globals.css).
const STYLES: Record<Verdict, string> = {
  hot: "text-verdict-hot border-verdict-hot/40 bg-verdict-hot/10",
  warm: "text-verdict-warm border-verdict-warm/40 bg-verdict-warm/10",
  cold: "text-verdict-cold border-verdict-cold/40 bg-verdict-cold/10",
  insufficient: "text-verdict-insufficient border-verdict-insufficient/40 bg-verdict-insufficient/10",
  disqualified: "text-verdict-disqualified border-verdict-disqualified/40 bg-verdict-disqualified/10",
};

export function VerdictBadge({ verdict, className }: { verdict: Verdict; className?: string }) {
  return (
    <Badge variant="outline" data-verdict={verdict} className={cn("capitalize", STYLES[verdict], className)}>
      {verdict}
    </Badge>
  );
}
