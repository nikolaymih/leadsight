import type { DbLike } from "../db/client.js";
import { appendEvent, lastEventAt } from "../db/events.js";
import type { LeadWithPost } from "../db/leads.js";
import { listAlertableLeadsSince } from "../db/leads.js";
import type { Campaign } from "../schema/index.js";
import type { Mailer } from "./mailer.js";
import type { Notifier } from "./notifier.js";

// Email digest: at most one email per campaign per `minInterval` (default 24 h), sent to the
// campaign's `notifications.digestRecipients`. The pipeline calls `notify` whenever a run
// produced alertable leads; the notifier decides whether a digest is due. When it is, the
// email covers every alertable lead scored since the previous digest (not just this run's),
// so nothing is lost while the notifier waits. Each send is recorded as a
// `notify.email_digest` event, which is also how the interval is enforced across restarts.

export const EMAIL_DIGEST_EVENT = "notify.email_digest";
export const DIGEST_MAX_LEADS = 50;

export interface EmailDigestOptions {
  db: DbLike;
  mailer: Mailer;
  /** Link target for "open in LeadSight"; omit to link only to the original posts. */
  webOrigin?: string;
  /** Minimum time between digests for one campaign. Default 24 h. */
  minInterval?: number;
  now?: () => Date;
}

export function createEmailDigestNotifier(opts: EmailDigestOptions): Notifier {
  const minInterval = opts.minInterval ?? 24 * 3_600_000;
  const now = opts.now ?? (() => new Date());

  return {
    name: "email",
    async notify(_leads, campaign) {
      const recipients = campaign.notifications.digestRecipients;
      if (recipients.length === 0) return;

      const current = now();
      const last = await lastEventAt(opts.db, campaign.organizationId, EMAIL_DIGEST_EVENT, campaign.id);
      if (last && current.getTime() - last.getTime() < minInterval) return;

      // First digest ever: look back one interval rather than the whole history.
      const since = last ?? new Date(current.getTime() - minInterval);
      const leads = await listAlertableLeadsSince(opts.db, campaign.organizationId, campaign.id, {
        since,
        minScore: campaign.minScoreAlert,
        limit: DIGEST_MAX_LEADS,
      });
      if (leads.length === 0) return;

      await opts.mailer.send({
        to: recipients,
        subject: digestSubject(campaign, leads.length),
        text: renderDigest(campaign, leads, { webOrigin: opts.webOrigin, since }),
      });
      await appendEvent(opts.db, {
        organizationId: campaign.organizationId,
        type: EMAIL_DIGEST_EVENT,
        entityType: "campaign",
        entityId: campaign.id,
        payload: { leads: leads.length, recipients: recipients.length, since: since.toISOString() },
      });
    },
  };
}

export function digestSubject(campaign: Pick<Campaign, "name">, count: number): string {
  return `[LeadSight] ${count} new lead${count === 1 ? "" : "s"} for ${campaign.name}`;
}

/** Plain text; every mail client renders it, and the content is links plus one-liners. */
export function renderDigest(
  campaign: Pick<Campaign, "id" | "name" | "minScoreAlert">,
  leads: readonly LeadWithPost[],
  opts: { webOrigin?: string; since: Date },
): string {
  const lines: string[] = [
    `${leads.length} new lead${leads.length === 1 ? "" : "s"} scored ${campaign.minScoreAlert}+ for "${campaign.name}" since ${opts.since.toISOString().slice(0, 16).replace("T", " ")} UTC.`,
    "",
  ];
  for (const lead of leads) {
    const title = (lead.post.title ?? lead.summary).trim();
    const author = lead.post.authorHandle ? ` by @${lead.post.authorHandle}` : "";
    lines.push(`[${lead.verdict.toUpperCase()} ${lead.score}] ${title}${author}`);
    if (lead.post.title && lead.summary) lines.push(`    ${lead.summary}`);
    lines.push(`    ${lead.post.url}`);
    lines.push("");
  }
  if (opts.webOrigin) lines.push(`Inbox: ${opts.webOrigin}/inbox?campaign=${campaign.id}`);
  return lines.join("\n").trimEnd().concat("\n");
}
