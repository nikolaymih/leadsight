import "server-only";
import { headers } from "next/headers";
import { authClient, type Session } from "@/lib/auth-client";

// Server-side session read for layouts and pages. Forwards the request cookie; the API
// enforces auth on every call regardless, so this is for routing and initial render only.
export async function getServerSession(): Promise<Session | null> {
  const cookie = (await headers()).get("cookie") ?? "";
  if (!cookie) return null;
  const { data } = await authClient.getSession({ fetchOptions: { headers: { cookie } } });
  return data ?? null;
}
