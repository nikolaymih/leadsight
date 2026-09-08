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

export type OrgRole = "member" | "admin" | "owner";

/** The signed-in user's role in the active organization. `null` until both are known. */
export function useOrgRole(): OrgRole | null {
  const { data: session } = authClient.useSession();
  const { members } = useOrgMembers();
  const role = members.find((m) => m.userId === session?.user.id)?.role;
  return role === "owner" || role === "admin" || role === "member" ? role : null;
}

export function canManage(role: OrgRole | null): boolean {
  return role === "admin" || role === "owner";
}

export function memberName(members: OrgMember[], userId: string | null): string {
  if (!userId) return "Unassigned";
  return members.find((m) => m.userId === userId)?.name ?? "Unknown";
}
