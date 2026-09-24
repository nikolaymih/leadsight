import type { Mailer, OutboundEmail } from "@leadsight/core";
import type { FastifyBaseLogger } from "fastify";
import { createTransport } from "nodemailer";

// Transports behind core's Mailer contract (packages/core/src/notify/mailer.ts). The
// digest notifier and Better Auth's reset/invitation emails both go through app.mailer.
// Without SMTP_URL the message is logged so a developer can copy the link out of the log.

export type { Mailer, OutboundEmail };

export function createLogMailer(log: FastifyBaseLogger): Mailer {
  return {
    kind: "log",
    async send(email) {
      log.info({ email }, "outbound email (no SMTP transport configured; not delivered)");
    },
  };
}

export interface SmtpMailerOptions {
  /** `smtp://user:pass@host:587` or `smtps://…:465`; anything nodemailer's URL form accepts. */
  url: string;
  /** RFC 5322 sender, e.g. `LeadSight <leads@example.com>`. */
  from: string;
}

export function createSmtpMailer(opts: SmtpMailerOptions): Mailer {
  const transport = createTransport(opts.url);
  return {
    kind: "smtp",
    async send(email) {
      await transport.sendMail({
        from: opts.from,
        to: typeof email.to === "string" ? email.to : [...email.to].join(", "),
        subject: email.subject,
        text: email.text,
      });
    },
  };
}
