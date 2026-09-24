import Link from "next/link";
import type { ReactNode } from "react";

export function AuthCard({
  title,
  children,
  footer,
}: {
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm">
        <Link href="/" className="mb-6 block text-center text-base font-semibold tracking-tight">
          LeadSight
        </Link>
        <div className="rounded-lg border border-border bg-card p-6 shadow-xs">
          <h1 className="mb-4 text-lg font-semibold">{title}</h1>
          {children}
        </div>
        {footer ? <p className="mt-4 text-center text-xs text-muted-foreground">{footer}</p> : null}
      </div>
    </main>
  );
}
