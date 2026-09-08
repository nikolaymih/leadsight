import { schema } from "@leadsight/core";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin, organization } from "better-auth/plugins";
import type { Env } from "./env.js";
import type { Db } from "./plugins/db.js";

// Better Auth server instance. Tables live in packages/core/src/schema/auth.ts;
// after changing plugins here, regenerate and diff them (see the better-auth skill).

export function createAuth({ env, db }: { env: Env; db: Db }) {
  const google =
    env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? { google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET } }
      : {};

  return betterAuth({
    baseURL: env.BETTER_AUTH_URL,
    basePath: "/api/auth",
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(db, { provider: "pg", schema }),
    emailAndPassword: { enabled: true },
    socialProviders: google,
    trustedOrigins: [env.WEB_ORIGIN],
    plugins: [organization({ allowUserToCreateOrganization: true }), admin()],
    session: { cookieCache: { enabled: true, maxAge: 5 * 60 } },
  });
}

export type Auth = ReturnType<typeof createAuth>;
