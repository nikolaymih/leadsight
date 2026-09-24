import { redirect } from "next/navigation";
import { AcceptInvitation } from "@/components/auth/accept-invitation";
import { AuthCard } from "@/components/auth/auth-card";
import { getServerSession } from "@/lib/auth-server";

export const metadata = { title: "Accept invitation" };

export default async function InvitePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getServerSession();
  if (!session) redirect(`/login?next=/invite/${id}`);
  return (
    <AuthCard title="You've been invited">
      <AcceptInvitation invitationId={id} />
    </AuthCard>
  );
}
