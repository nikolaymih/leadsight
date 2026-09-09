// Outbound email contract. Core only describes the message; apps/api supplies the transport
// (SMTP via nodemailer, or a log-only mailer in development). Used by the digest notifier
// here and by Better Auth's reset/invitation emails in the API.

export interface OutboundEmail {
  to: string | readonly string[];
  subject: string;
  text: string;
}

export interface Mailer {
  /** Where the mail goes, for status displays: `"smtp"` or `"log"`. */
  readonly kind: "smtp" | "log";
  send(email: OutboundEmail): Promise<void>;
}
