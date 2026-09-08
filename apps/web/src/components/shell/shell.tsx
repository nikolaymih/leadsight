"use client";

import { Inbox, Megaphone, Rss, Settings } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { CampaignSelector } from "./campaign-selector";
import { OrgSwitcher } from "./org-switcher";
import { UserMenu } from "./user-menu";

const NAV = [
  { href: "/inbox", label: "Inbox", icon: Inbox },
  { href: "/campaigns", label: "Campaigns", icon: Megaphone },
  { href: "/sources", label: "Sources & Runs", icon: Rss },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

export interface ShellUser {
  name: string;
  email: string;
  image: string | null;
}

export function Shell({ user, children }: { user: ShellUser; children: ReactNode }) {
  const pathname = usePathname();
  const scoped = pathname.startsWith("/inbox") || pathname.startsWith("/sources");

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-52 shrink-0 flex-col border-r border-border bg-card md:flex">
        <div className="flex h-12 items-center px-4 text-sm font-semibold tracking-tight">LeadSight</div>
        <nav className="flex flex-col gap-0.5 px-2">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || pathname.startsWith(`${href}/`);
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "flex h-8 items-center gap-2 rounded-[var(--radius)] px-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground",
                  active && "bg-muted text-foreground font-medium",
                )}
                aria-current={active ? "page" : undefined}
              >
                <Icon className="size-4" />
                {label}
              </Link>
            );
          })}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 items-center gap-3 border-b border-border bg-card px-4">
          <nav className="flex gap-3 text-sm md:hidden">
            {NAV.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                className={cn(pathname.startsWith(href) ? "font-medium" : "text-muted-foreground")}
              >
                {label}
              </Link>
            ))}
          </nav>
          <div className="hidden md:block">{scoped ? <CampaignSelector /> : null}</div>
          <div className="ml-auto flex items-center gap-2">
            <OrgSwitcher />
            <UserMenu user={user} />
          </div>
        </header>
        <main className="min-w-0 flex-1 p-4">{children}</main>
      </div>
    </div>
  );
}
