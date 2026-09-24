import "server-only";
import type { Contract } from "@leadsight/contract";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { ContractRouterClient } from "@orpc/contract";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { headers } from "next/headers";
import { env } from "@/lib/env";

// Per-request client for server components: forwards the browser's cookie so the API
// sees the same session. Used to prefetch into the query cache; never cached across requests.

export async function serverOrpc() {
  const cookie = (await headers()).get("cookie") ?? "";
  const link = new RPCLink({
    url: `${env.NEXT_PUBLIC_API_URL}/rpc`,
    headers: { cookie },
  });
  const client: ContractRouterClient<Contract> = createORPCClient(link);
  return { client, orpc: createTanstackQueryUtils(client) };
}
