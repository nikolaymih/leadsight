"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Building2, Check, ChevronsUpDown } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { authClient } from "@/lib/auth-client";

export function OrgSwitcher() {
  const router = useRouter();
  const qc = useQueryClient();
  const { data: organizations } = authClient.useListOrganizations();
  const { data: active } = authClient.useActiveOrganization();

  async function switchTo(organizationId: string) {
    const { error } = await authClient.organization.setActive({ organizationId });
    if (error) return toast.error(error.message ?? "Could not switch organization");
    await qc.invalidateQueries(); // everything is tenant-scoped
    router.refresh();
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="max-w-48 gap-1.5" aria-label="Switch organization">
          <Building2 className="size-3.5 text-muted-foreground" />
          <span className="truncate">{active?.name ?? "Organization"}</span>
          <ChevronsUpDown className="size-3 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Organizations</DropdownMenuLabel>
        {(organizations ?? []).map((org) => (
          <DropdownMenuItem key={org.id} onSelect={() => void switchTo(org.id)}>
            <span className="flex-1 truncate">{org.name}</span>
            {org.id === active?.id ? <Check className="size-3.5" /> : null}
          </DropdownMenuItem>
        ))}
        <DropdownMenuItem onSelect={() => router.push("/onboarding")}>New organization…</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
