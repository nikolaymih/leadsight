import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { Providers } from "@/components/shell/providers";
import { Shell } from "@/components/shell/shell";
import { getServerSession } from "@/lib/auth-server";

// Authenticated shell. The session check here is for routing; the API enforces auth itself.
export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await getServerSession();
  if (!session) redirect("/login");
  return (
    <Providers>
      <Shell user={{ name: session.user.name, email: session.user.email, image: session.user.image ?? null }}>
        {children}
      </Shell>
    </Providers>
  );
}
