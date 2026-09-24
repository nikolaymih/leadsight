"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/misc";
import { authClient } from "@/lib/auth-client";

// Profile and password. Theme follows the OS (no browser storage for preferences); notification
// preferences arrive with the notifiers release.

export function Personal() {
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();

  const rename = useMutation({
    mutationFn: async (name: string) => {
      const { error } = await authClient.updateUser({ name });
      if (error) throw new Error(error.message ?? "Could not update the profile");
    },
    onSuccess: () => {
      toast.success("Profile updated");
      router.refresh();
    },
    onError: (e) => toast.error(e.message),
  });

  const password = useMutation({
    mutationFn: async (v: { currentPassword: string; newPassword: string }) => {
      const { error } = await authClient.changePassword({ ...v, revokeOtherSessions: true });
      if (error) throw new Error(error.message ?? "Could not change the password");
    },
    onSuccess: () => toast.success("Password changed. Other sessions were signed out."),
    onError: (e) => toast.error(e.message),
  });

  if (isPending || !session) return <Skeleton className="h-40 w-full" />;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Profile</CardTitle>
            <CardDescription>{session.user.email}</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <NameForm name={session.user.name} pending={rename.isPending} onSubmit={(n) => rename.mutate(n)} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Password</CardTitle>
            <CardDescription>Changing it signs out your other sessions.</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <PasswordForm pending={password.isPending} onSubmit={(v) => password.mutate(v)} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Appearance & notifications</CardTitle>
            <CardDescription>
              The theme follows your operating system. Personal notification preferences arrive with the
              notifiers release.
            </CardDescription>
          </div>
        </CardHeader>
      </Card>
    </div>
  );
}

function NameForm({
  name,
  pending,
  onSubmit,
}: {
  name: string;
  pending: boolean;
  onSubmit: (name: string) => void;
}) {
  const form = useForm<{ name: string }>({
    resolver: zodResolver(z.object({ name: z.string().trim().min(1, "Your name") })),
    defaultValues: { name },
  });
  return (
    <form onSubmit={form.handleSubmit((v) => onSubmit(v.name))} className="flex items-end gap-2">
      <Field
        label="Name"
        htmlFor="user-name"
        error={form.formState.errors.name?.message}
        className="max-w-sm flex-1"
      >
        <Input id="user-name" disabled={pending} {...form.register("name")} />
      </Field>
      <Button type="submit" variant="outline" disabled={pending || !form.formState.isDirty}>
        Save
      </Button>
    </form>
  );
}

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1, "Required"),
    newPassword: z.string().min(8, "At least 8 characters"),
    confirm: z.string(),
  })
  .refine((v) => v.newPassword === v.confirm, { message: "Passwords do not match", path: ["confirm"] });

function PasswordForm({
  pending,
  onSubmit,
}: {
  pending: boolean;
  onSubmit: (v: { currentPassword: string; newPassword: string }) => void;
}) {
  const form = useForm<z.infer<typeof passwordSchema>>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { currentPassword: "", newPassword: "", confirm: "" },
  });
  const e = form.formState.errors;
  return (
    <form
      onSubmit={form.handleSubmit((v) => {
        onSubmit({ currentPassword: v.currentPassword, newPassword: v.newPassword });
        form.reset();
      })}
      className="grid max-w-lg gap-3 sm:grid-cols-3"
    >
      <Field label="Current" htmlFor="current-password" error={e.currentPassword?.message}>
        <Input
          id="current-password"
          type="password"
          autoComplete="current-password"
          disabled={pending}
          {...form.register("currentPassword")}
        />
      </Field>
      <Field label="New" htmlFor="new-password" error={e.newPassword?.message}>
        <Input
          id="new-password"
          type="password"
          autoComplete="new-password"
          disabled={pending}
          {...form.register("newPassword")}
        />
      </Field>
      <Field label="Confirm" htmlFor="confirm-password" error={e.confirm?.message}>
        <Input
          id="confirm-password"
          type="password"
          autoComplete="new-password"
          disabled={pending}
          {...form.register("confirm")}
        />
      </Field>
      <div className="sm:col-span-3">
        <Button type="submit" variant="outline" disabled={pending}>
          Change password
        </Button>
      </div>
    </form>
  );
}
