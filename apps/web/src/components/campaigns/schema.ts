import {
  campaignDraftSchema,
  notificationSettingsSchema,
  type sourceConfigSchema,
} from "@leadsight/contract";
import { z } from "zod";

// The campaign form validates with the same Zod the API uses (campaignDraftSchema), so a form
// that passes here is accepted by campaigns.create / campaigns.update. Sources and alert
// queries are handled outside the form (SourceSuggestions). The tuning fields exist only on a
// saved campaign, hence optional.

export const campaignFormSchema = campaignDraftSchema
  .omit({ alertQueries: true, suggestedSources: true })
  .extend({
    minConfidence: z.number().int().min(0).max(100).optional(),
    minScoreAlert: z.number().int().min(0).max(100).optional(),
    fewshotLimit: z.number().int().min(0).max(50).optional(),
    notifications: notificationSettingsSchema.optional(),
  });

export type CampaignFormValues = z.infer<typeof campaignFormSchema>;
export type CriterionValues = CampaignFormValues["criteria"][number];
export type SourceConfig = z.infer<typeof sourceConfigSchema>;

export const EMPTY_FORM: CampaignFormValues = {
  name: "",
  offerDescription: "",
  icp: "",
  disqualifiers: [],
  keywords: [],
  criteria: [{ key: "", question: "", type: "boolean", weight: 100 }],
  thresholds: { hot: 70, warm: 40 },
};

export function weightTotal(criteria: readonly { weight: number }[]): number {
  return criteria.reduce((sum, c) => sum + (Number.isFinite(c.weight) ? c.weight : 0), 0);
}

/** snake_case key from a question, for the "add criterion" flow. */
export function keyFromQuestion(question: string): string {
  return question
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^(\d)/, "c_$1")
    .split("_")
    .slice(0, 4)
    .join("_");
}

/** Platform a Google Alerts query targets, from its `site:` operator. */
export function platformForAlertQuery(
  query: string,
): SourceConfig["config"] extends infer C ? (C extends { platform: infer P } ? P : never) : never {
  const q = query.toLowerCase();
  if (q.includes("linkedin.com")) return "linkedin";
  if (q.includes("x.com") || q.includes("twitter.com")) return "x";
  if (q.includes("facebook.com")) return "facebook";
  return "web";
}
