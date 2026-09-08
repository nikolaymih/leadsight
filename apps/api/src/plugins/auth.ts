import fp from "fastify-plugin";
import { type Auth, createAuth } from "../auth.js";
import type { Env } from "../env.js";
import { toWebRequest } from "../http.js";

declare module "fastify" {
  interface FastifyInstance {
    auth: Auth;
  }
}

export interface AuthPluginOptions {
  env: Env;
}

// Headers that describe the transport of the original Response body, not the
// body we re-send through Fastify. Fastify computes its own.
const HOP_BY_HOP = new Set(["content-length", "transfer-encoding", "set-cookie"]);

export const authPlugin = fp<AuthPluginOptions>(
  async (app, opts) => {
    const auth = createAuth({ env: opts.env, db: app.db });
    app.decorate("auth", auth);

    // Encapsulated scope: the raw-string body parser applies to Better Auth
    // routes only, so the rest of the app keeps Fastify's JSON parsing.
    await app.register(async (scope) => {
      scope.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => {
        done(null, body);
      });

      scope.route({
        method: ["GET", "POST"],
        url: "/api/auth/*",
        async handler(request, reply) {
          const response = await auth.handler(toWebRequest(request));

          reply.status(response.status);
          response.headers.forEach((value, key) => {
            if (!HOP_BY_HOP.has(key)) reply.header(key, value);
          });
          const cookies = response.headers.getSetCookie();
          if (cookies.length > 0) reply.header("set-cookie", cookies);

          return reply.send(response.body ? await response.text() : null);
        },
      });
    });
  },
  { name: "auth", dependencies: ["db"] },
);
