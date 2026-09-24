import fp from "fastify-plugin";
import type { Env } from "../env.js";
import { createLogMailer, createSmtpMailer, type Mailer } from "../mailer.js";

declare module "fastify" {
  interface FastifyInstance {
    mailer: Mailer;
    /** Sender address when SMTP is configured; null with the log mailer. */
    mailFrom: string | null;
  }
}

export interface MailerPluginOptions {
  env: Env;
}

/** One mailer per process: SMTP when SMTP_URL is set, otherwise log-only. */
export const mailerPlugin = fp<MailerPluginOptions>(
  async (app, { env }) => {
    if (env.SMTP_URL) {
      app.decorate("mailer", createSmtpMailer({ url: env.SMTP_URL, from: env.SMTP_FROM }));
      app.decorate("mailFrom", env.SMTP_FROM);
    } else {
      if (env.NODE_ENV === "production") {
        app.log.warn({}, "SMTP_URL not set: password resets, invitations and digests are logged, not sent");
      }
      app.decorate("mailer", createLogMailer(app.log));
      app.decorate("mailFrom", null);
    }
  },
  { name: "mailer" },
);
