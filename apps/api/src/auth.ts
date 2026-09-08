import { type Db, schema } from "@leadsight/core";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin, organization } from "better-auth/plugins";
import type { Env } from "./env.js";
import type { Mailer } from "./mailer.js";

// Better Auth server instance. Tables live in packages/core/src/schema/auth.ts;
// after changing plugins here, regenerate and diff them (see the better-auth skill).

export function createAuth({ env, db, mailer }: { env: Env; db: Db; mailer: Mailer }) {
  const google =
    env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? { google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET } }
      : {};

  return betterAuth({
    baseURL: env.BETTER_AUTH_URL,
    basePath: "/api/auth",
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(db, { provider: "pg", schema }),
    emailAndPassword: {
      enabled: true,
      async sendResetPassword({ user, url }) {
        await mailer.send({
          to: user.email,
          subject: "Reset your LeadSight password",
          text: `Open this link to choose a new password (valid for one hour):\n\n${url}\n\nIf you didn't ask for this, ignore this email.`,
        });
      },
    },
    socialProviders: google,
    trustedOrigins: [env.WEB_ORIGIN],
    plugins: [
      organization({
        allowUserToCreateOrganization: true,
        async sendInvitationEmail(data) {
          // The web app owns the accept screen; the API only knows where the web app lives.
          const url = `${env.WEB_ORIGIN}/invite/${data.id}`;
          await mailer.send({
            to: data.email,
            subject: `${data.inviter.user.name} invited you to ${data.organization.name} on LeadSight`,
            text: `${data.inviter.user.name} (${data.inviter.user.email}) invited you to join ${data.organization.name} as ${data.role}.\n\nAccept the invitation:\n${url}`,
          });
        },
      }),
      admin(),
    ],
    session: { cookieCache: { enabled: true, maxAge: 5 * 60 } },
  });
}

export type Auth = ReturnType<typeof createAuth>;
