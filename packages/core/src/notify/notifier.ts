import type { LeadWithPost } from "../db/leads.js";
import type { Campaign } from "../schema/index.js";

// Notifier contract — docs/design.md §3.4. Called once per campaign per pipeline run
// with the new leads at or above `minScoreAlert` (never insufficient/disqualified).
// Implementations (Slack webhook, email digest) arrive in step 9.

export interface Notifier {
  readonly name: string;
  notify(leads: readonly LeadWithPost[], campaign: Campaign): Promise<void>;
}
