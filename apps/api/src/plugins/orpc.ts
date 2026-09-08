import { RPCHandler } from "@orpc/server/fastify";
import fp from "fastify-plugin";
import { buildContext } from "../orpc/context.js";
import { router } from "../orpc/router.js";

// RPC protocol for the web app. If a third party ever needs REST, add
// OpenAPIHandler on /api/* — every contract route already carries method + path.
export const orpcPlugin = fp(
  async (app) => {
    const handler = new RPCHandler(router);

    app.all("/rpc/*", async (request, reply) => {
      const { matched } = await handler.handle(request, reply, {
        prefix: "/rpc",
        context: await buildContext(request, { db: app.db, auth: app.auth }),
      });
      if (!matched) return reply.status(404).send({ error: "not found" });
    });
  },
  { name: "orpc", dependencies: ["db", "auth"] },
);
