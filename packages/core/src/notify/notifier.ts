import type { LeadWithPost } from "../db/leads.js";
import type { Campaign } from "../schema/index.js";

// Notifier contract — docs/design.md §3.4. Called once per campaign per pipeline run
// with the new leads at or above `minScoreAlert` (never insufficient/disqualified).
// v1 ships the email digest (`email.ts`); a chat notifier (Slack or similar) is deferred
// and would implement this same interface.

export interface Notifier {
  readonly name: string;
  notify(leads: readonly LeadWithPost[], campaign: Campaign): Promise<void>;
}
