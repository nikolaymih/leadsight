"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/misc";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { canManage, type OrgRole } from "@/hooks/use-org-members";
import { authClient } from "@/lib/auth-client";
import { formatRelative } from "@/lib/format";

// Organization: name, members with roles, invitations. Better Auth's organization plugin is the
// store; reads go through TanStack Query keyed under ["auth", …] so mutations can invalidate.

const ROLES: OrgRole[] = ["member", "admin", "owner"];
const orgKey = (id: string) => ["auth", "organization", id] as const;
const invitesKey = (id: string) => ["auth", "invitations", id] as const;

export function OrgSettings() {
  const { data: session } = authClient.useSession();
  const { data: active } = authClient.useActiveOrganization();
  if (!active || !session) return <Skeleton className="h-40 w-full" />;
  return <OrgSettingsBody organizationId={active.id} currentUserId={session.user.id} />;
}

function OrgSettingsBody({
  organizationId,
  currentUserId,
}: {
  organizationId: string;
  currentUserId: string;
}) {
  const qc = useQueryClient();
  const org = useQuery({
    queryKey: orgKey(organizationId),
    queryFn: async () => {
      const { data, error } = await authClient.organization.getFullOrganization({
        query: { organizationId },
      });
      if (error || !data) throw new Error(error?.message ?? "Could not load the organization");
      return data;
    },
  });
  const invitations = useQuery({
    queryKey: invitesKey(organizationId),
    queryFn: async () => {
      const { data, error } = await authClient.organization.listInvitations({ query: { organizationId } });
      if (error) throw new Error(error.message ?? "Could not load invitations");
      return (data ?? []).filter((i) => i.status === "pending");
    },
  });

  const me = org.data?.members.find((m) => m.userId === currentUserId);
  const myRole = (me?.role ?? null) as OrgRole | null;
  const manage = canManage(myRole);

  async function refresh() {
    await Promise.all([
      qc.invalidateQueries({ queryKey: orgKey(organizationId) }),
      qc.invalidateQueries({ queryKey: invitesKey(organizationId) }),
    ]);
  }

  const rename = useMutation({
    mutationFn: async (name: string) => {
      const { error } = await authClient.organization.update({ organizationId, data: { name } });
      if (error) throw new Error(error.message ?? "Rename failed");
    },
    onSuccess: async () => {
      await refresh();
      // The top-bar switcher reads the active-organization atom; setting it active re-reads it.
      await authClient.organization.setActive({ organizationId });
      toast.success("Organization renamed");
    },
    onError: (e) => toast.error(e.message),
  });
  const invite = useMutation({
    mutationFn: async (input: { email: string; role: OrgRole }) => {
      const { error } = await authClient.organization.inviteMember({
        organizationId,
        email: input.email,
        role: input.role,
      });
      if (error) throw new Error(error.message ?? "Invite failed");
    },
    onSuccess: async () => {
      await refresh();
      toast.success("Invitation sent");
    },
    onError: (e) => toast.error(e.message),
  });
  const cancelInvite = useMutation({
    mutationFn: async (invitationId: string) => {
      const { error } = await authClient.organization.cancelInvitation({ invitationId });
      if (error) throw new Error(error.message ?? "Could not cancel");
    },
    onSuccess: refresh,
    onError: (e) => toast.error(e.message),
  });
  const setRole = useMutation({
    mutationFn: async (input: { memberId: string; role: OrgRole }) => {
      const { error } = await authClient.organization.updateMemberRole({
        organizationId,
        memberId: input.memberId,
        role: input.role,
      });
      if (error) throw new Error(error.message ?? "Could not change the role");
    },
    onSuccess: refresh,
    onError: (e) => toast.error(e.message),
  });
  const removeMember = useMutation({
    mutationFn: async (memberId: string) => {
      const { error } = await authClient.organization.removeMember({
        organizationId,
        memberIdOrEmail: memberId,
      });
      if (error) throw new Error(error.message ?? "Could not remove the member");
    },
    onSuccess: async () => {
      await refresh();
      toast.success("Member removed");
    },
    onError: (e) => toast.error(e.message),
  });

  if (org.isPending) return <Skeleton className="h-40 w-full" />;
  if (org.isError) return <p className="text-sm text-destructive">{org.error.message}</p>;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Organization</CardTitle>
            <CardDescription>Campaigns, sources and leads are scoped to it.</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <RenameForm
            name={org.data.name}
            disabled={!manage || rename.isPending}
            onSubmit={(name) => rename.mutate(name)}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Members</CardTitle>
            <CardDescription>
              Admins manage campaigns and sources; members triage leads. Owners can also manage roles.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {org.data.members.map((m) => {
                const isSelf = m.userId === currentUserId;
                const canEdit = myRole === "owner" && !isSelf;
                return (
                  <TableRow key={m.id}>
                    <TableCell className="font-medium">
                      {m.user.name}
                      {isSelf ? <span className="ml-1 text-xs text-muted-foreground">(you)</span> : null}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{m.user.email}</TableCell>
                    <TableCell>
                      {canEdit ? (
                        <Select
                          value={m.role}
                          onValueChange={(role) => setRole.mutate({ memberId: m.id, role: role as OrgRole })}
                        >
                          <SelectTrigger size="sm" className="w-28" aria-label={`Role for ${m.user.name}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {ROLES.map((r) => (
                              <SelectItem key={r} value={r} className="capitalize">
                                {r}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Badge variant="secondary" className="capitalize">
                          {m.role}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatRelative(
                        m.createdAt instanceof Date ? m.createdAt.toISOString() : String(m.createdAt),
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {canEdit ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={removeMember.isPending}
                          onClick={() => removeMember.mutate(m.id)}
                        >
                          Remove
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>

          {manage ? <InviteForm disabled={invite.isPending} onSubmit={(v) => invite.mutate(v)} /> : null}

          {invitations.data && invitations.data.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Pending invitations
              </h4>
              <ul className="flex flex-col gap-1">
                {invitations.data.map((i) => (
                  <li
                    key={i.id}
                    className="flex items-center justify-between gap-3 rounded-[var(--radius)] border border-border px-3 py-1.5 text-sm"
                  >
                    <span className="min-w-0 truncate">
                      {i.email} <span className="text-xs text-muted-foreground">· {i.role}</span>
                    </span>
                    {manage ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={cancelInvite.isPending}
                        onClick={() => cancelInvite.mutate(i.id)}
                      >
                        Cancel
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

function RenameForm({
  name,
  disabled,
  onSubmit,
}: {
  name: string;
  disabled: boolean;
  onSubmit: (name: string) => void;
}) {
  const form = useForm<{ name: string }>({
    resolver: zodResolver(z.object({ name: z.string().trim().min(2, "At least 2 characters") })),
    defaultValues: { name },
  });
  return (
    <form onSubmit={form.handleSubmit((v) => onSubmit(v.name))} className="flex items-end gap-2">
      <Field
        label="Name"
        htmlFor="org-name"
        error={form.formState.errors.name?.message}
        className="max-w-sm flex-1"
      >
        <Input id="org-name" disabled={disabled} {...form.register("name")} />
      </Field>
      <Button type="submit" variant="outline" disabled={disabled || !form.formState.isDirty}>
        Rename
      </Button>
    </form>
  );
}

function InviteForm({
  disabled,
  onSubmit,
}: {
  disabled: boolean;
  onSubmit: (v: { email: string; role: OrgRole }) => void;
}) {
  const form = useForm<{ email: string; role: OrgRole }>({
    resolver: zodResolver(
      z.object({
        email: z.string().email("Enter a valid email"),
        role: z.enum(["member", "admin", "owner"]),
      }),
    ),
    defaultValues: { email: "", role: "member" },
  });
  return (
    <form
      onSubmit={form.handleSubmit((v) => {
        onSubmit(v);
        form.reset();
      })}
      className="flex flex-wrap items-end gap-2"
    >
      <Field
        label="Invite by email"
        htmlFor="invite-email"
        error={form.formState.errors.email?.message}
        className="min-w-56 flex-1"
      >
        <Input
          id="invite-email"
          type="email"
          placeholder="colleague@company.com"
          disabled={disabled}
          {...form.register("email")}
        />
      </Field>
      <Field label="Role" htmlFor="invite-role">
        <Select value={form.watch("role")} onValueChange={(v) => form.setValue("role", v as OrgRole)}>
          <SelectTrigger id="invite-role" className="w-28">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ROLES.filter((r) => r !== "owner").map((r) => (
              <SelectItem key={r} value={r} className="capitalize">
                {r}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Button type="submit" disabled={disabled}>
        {disabled ? <Loader2 className="animate-spin" /> : null}
        Send invite
      </Button>
    </form>
  );
}
