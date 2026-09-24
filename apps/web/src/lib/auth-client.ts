import { adminClient, organizationClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { env } from "@/lib/env";

// Better Auth browser client. The API serves auth at <API>/api/auth/*; cookies cross the
// port boundary in dev with credentials: "include" and trustedOrigins on the server.
export const authClient = createAuthClient({
  baseURL: env.NEXT_PUBLIC_API_URL,
  plugins: [organizationClient(), adminClient()],
  fetchOptions: { credentials: "include" },
});

export type Session = typeof authClient.$Infer.Session;
export type Organization = typeof authClient.$Infer.Organization;
