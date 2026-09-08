"use client";

import { authClient } from "@/lib/auth-client";

export interface OrgMember {
  userId: string;
  name: string;
  email: string;
  image: string | null;
  role: string;
}

/** Members of the active organization, for assignee pickers and the settings screen. */
export function useOrgMembers(): { members: OrgMember[]; isPending: boolean } {
  const { data, isPending } = authClient.useActiveOrganization();
  const members = (data?.members ?? []).map((m) => ({
    userId: m.userId,
    name: m.user.name,
    email: m.user.email,
    image: m.user.image ?? null,
    role: m.role,
  }));
  return { members, isPending };
}

export function memberName(members: OrgMember[], userId: string | null): string {
  if (!userId) return "Unassigned";
  return members.find((m) => m.userId === userId)?.name ?? "Unknown";
}
