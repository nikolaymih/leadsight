import type { FastifyBaseLogger } from "fastify";

// Outbound transactional email (password resets, invitations). Better Auth calls the
// mailer with a ready-made link; the mailer only decides how to deliver it. Until an
// SMTP transport is configured (step 9, nodemailer) the link is logged so a developer
// can copy it out of the API log.

export interface OutboundEmail {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  send(email: OutboundEmail): Promise<void>;
}

export function createLogMailer(log: FastifyBaseLogger): Mailer {
  return {
    async send(email) {
      log.info({ email }, "outbound email (no SMTP transport configured; not delivered)");
    },
  };
}
