import type { Contract } from "@leadsight/contract";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { ContractRouterClient } from "@orpc/contract";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { env } from "@/lib/env";

// Browser client. `credentials: "include"` carries Better Auth's session cookie to the API.
// Components never call `client.*` directly — go through `orpc.*` so cache keys stay consistent.

const link = new RPCLink({
  url: `${env.NEXT_PUBLIC_API_URL}/rpc`,
  fetch: (request, init) => fetch(request, { ...init, credentials: "include" }),
});

export const client: ContractRouterClient<Contract> = createORPCClient(link);
export const orpc = createTanstackQueryUtils(client);
