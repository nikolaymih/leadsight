import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

// Dense table primitives. Rows are 32px; numbers use tabular figures.

export function Table({ className, ...props }: ComponentProps<"table">) {
  return (
    <div className="w-full overflow-x-auto">
      <table className={cn("w-full caption-bottom text-sm", className)} {...props} />
    </div>
  );
}
export const TableHeader = ({ className, ...props }: ComponentProps<"thead">) => (
  <thead className={cn("[&_tr]:border-b", className)} {...props} />
);
export const TableBody = ({ className, ...props }: ComponentProps<"tbody">) => (
  <tbody className={cn("[&_tr:last-child]:border-0", className)} {...props} />
);
export const TableRow = ({ className, ...props }: ComponentProps<"tr">) => (
  <tr
    className={cn(
      "border-b border-border transition-colors hover:bg-muted/60 data-[state=selected]:bg-accent/5 data-[active=true]:bg-accent/10",
      className,
    )}
    {...props}
  />
);
export const TableHead = ({ className, ...props }: ComponentProps<"th">) => (
  <th
    className={cn(
      "h-8 px-2 text-left align-middle text-xs font-medium text-muted-foreground whitespace-nowrap [&:has([role=checkbox])]:pr-0",
      className,
    )}
    {...props}
  />
);
export const TableCell = ({ className, ...props }: ComponentProps<"td">) => (
  <td
    className={cn("h-8 px-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0", className)}
    {...props}
  />
);
