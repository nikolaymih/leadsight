import { type Contract, campaignSchema, leadSummarySchema, postSchema } from "@leadsight/contract";
import type { InferContractRouterInputs, InferContractRouterOutputs } from "@orpc/contract";

// Wire types inferred from the contract. apps/web never imports core, so enums come from
// the contract's Zod schemas rather than core's constant arrays.

type Outputs = InferContractRouterOutputs<Contract>;
type Inputs = InferContractRouterInputs<Contract>;

export type Campaign = Outputs["campaigns"]["list"][number];
export type Criterion = Campaign["criteria"][number];
export type Source = Outputs["sources"]["list"][number];
export type LeadSummary = Outputs["leads"]["list"]["items"][number];
export type LeadDetail = Outputs["leads"]["get"];
export type LeadNote = LeadDetail["notes"][number];
export type Evidence = LeadDetail["evidence"];
export type PipelineRun = Outputs["runs"]["list"][number];
export type ProviderBudget = Outputs["runs"]["budget"][number];

export type LeadListInput = Inputs["leads"]["list"];
export type LeadListPage = Outputs["leads"]["list"];

export const VERDICTS = leadSummarySchema.shape.verdict.options;
export const LEAD_STATUSES = leadSummarySchema.shape.status.options;
export const PLATFORMS = postSchema.shape.platform.options;
export const CAMPAIGN_STATUSES = campaignSchema.shape.status.options;

export type Verdict = LeadSummary["verdict"];
export type LeadStatus = LeadSummary["status"];
export type Platform = LeadSummary["post"]["platform"];
export type CampaignStatus = Campaign["status"];
