"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { authClient } from "@/lib/auth-client";
import type { ShellUser } from "./shell";

export function UserMenu({ user }: { user: ShellUser }) {
  const router = useRouter();
  const initials = user.name
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Account menu" className="rounded-full">
          {user.image ? (
            // Avatar URLs come from arbitrary OAuth providers; next/image would need a remotePatterns allowlist.
            // biome-ignore lint/performance/noImgElement: 24px avatar from an unknown host
            <img src={user.image} alt="" className="size-6 rounded-full" />
          ) : (
            <span className="flex size-6 items-center justify-center rounded-full bg-accent text-[10px] font-semibold text-accent-foreground">
              {initials || "?"}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="font-normal">
          <div className="text-sm text-foreground">{user.name}</div>
          <div className="truncate text-xs">{user.email}</div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => router.push("/settings")}>Settings</DropdownMenuItem>
        <DropdownMenuItem
          onSelect={async () => {
            await authClient.signOut();
            router.replace("/login");
          }}
        >
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
