"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

export function AcceptInvitation({ invitationId }: { invitationId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function accept() {
    setBusy(true);
    setError(null);
    const { data, error } = await authClient.organization.acceptInvitation({ invitationId });
    setBusy(false);
    if (error || !data) return setError(error?.message ?? "Could not accept the invitation");
    await authClient.organization.setActive({ organizationId: data.invitation.organizationId });
    router.replace("/inbox");
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Join the organization to start seeing its campaigns and leads.
      </p>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      <Button onClick={accept} disabled={busy}>
        Accept invitation
      </Button>
    </div>
  );
}
