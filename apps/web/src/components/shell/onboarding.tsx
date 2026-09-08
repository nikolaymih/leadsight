"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";

// First run: create an organization (the creator becomes owner) or accept a pending invitation.

const schema = z.object({ name: z.string().min(2, "Give it a name") });

export function Onboarding() {
  const router = useRouter();
  const qc = useQueryClient();
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) });

  const submit = form.handleSubmit(async ({ name }) => {
    const slug = `${name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")}-${Math.random().toString(36).slice(2, 6)}`;
    const { data, error } = await authClient.organization.create({ name, slug });
    if (error || !data) return toast.error(error?.message ?? "Could not create the organization");
    // Creating sets the org active on the server; setActive refreshes the client's cached session too.
    await authClient.organization.setActive({ organizationId: data.id });
    await qc.invalidateQueries();
    router.replace("/campaigns/new");
  });

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Create an organization</CardTitle>
            <CardDescription>
              Campaigns, sources and leads belong to an organization. You'll be its owner.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="flex items-end gap-2">
            <Field
              label="Name"
              htmlFor="org-name"
              error={form.formState.errors.name?.message}
              className="flex-1"
            >
              <Input id="org-name" placeholder="Dev Craft" {...form.register("name")} />
            </Field>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              Create
            </Button>
          </form>
        </CardContent>
      </Card>
      <p className="text-center text-xs text-muted-foreground">
        Been invited? Open the link from your invitation email to join an existing organization.
      </p>
    </div>
  );
}
