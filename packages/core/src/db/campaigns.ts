import { and, desc, eq, sql } from "drizzle-orm";
import { NotFoundError, ValidationError } from "../errors.js";
import { type Campaign, campaigns } from "../schema/index.js";
import { type Criteria, criteriaSchema, type Thresholds, thresholdsSchema } from "../types.js";
import type { DbLike } from "./client.js";

export interface CreateCampaignInput {
  name: string;
  offerDescription: string;
  icp: string;
  disqualifiers: string[];
  keywords: string[];
  criteria: Criteria;
  thresholds: Thresholds;
  minConfidence?: number;
  minScoreAlert?: number;
  fewshotLimit?: number;
  createdBy: string;
}

export type UpdateCampaignPatch = Partial<
  Pick<
    Campaign,
    | "name"
    | "status"
    | "offerDescription"
    | "icp"
    | "disqualifiers"
    | "keywords"
    | "criteria"
    | "thresholds"
    | "minConfidence"
    | "minScoreAlert"
    | "fewshotLimit"
  >
>;

export async function listCampaigns(db: DbLike, orgId: string): Promise<Campaign[]> {
  return db
    .select()
    .from(campaigns)
    .where(eq(campaigns.organizationId, orgId))
    .orderBy(desc(campaigns.createdAt));
}

/**
 * Active campaigns across every organization — for the pipeline, a system actor.
 * The second and last deliberate cross-org query (with findDueSourcesAllOrgs).
 */
export async function listActiveCampaignsAllOrgs(db: DbLike): Promise<Campaign[]> {
  return db.select().from(campaigns).where(eq(campaigns.status, "active")).orderBy(campaigns.createdAt);
}

export async function getCampaign(db: DbLike, orgId: string, id: string): Promise<Campaign> {
  const [row] = await db
    .select()
    .from(campaigns)
    .where(and(eq(campaigns.organizationId, orgId), eq(campaigns.id, id)))
    .limit(1);
  if (!row) throw new NotFoundError("campaign", id);
  return row;
}

export async function createCampaign(
  db: DbLike,
  orgId: string,
  input: CreateCampaignInput,
): Promise<Campaign> {
  const criteria = validate(criteriaSchema, input.criteria, "criteria");
  const thresholds = validate(thresholdsSchema, input.thresholds, "thresholds");

  const [row] = await db
    .insert(campaigns)
    .values({ ...input, criteria, thresholds, organizationId: orgId, rulesVersion: 1 })
    .returning();
  if (!row) throw new Error("insert returned no row");
  return row;
}

/**
 * Edits to `criteria` bump `rulesVersion`; leads keep the version they were scored with
 * until an explicit rescore. Other fields never bump it.
 */
export async function updateCampaign(
  db: DbLike,
  orgId: string,
  id: string,
  patch: UpdateCampaignPatch,
): Promise<Campaign> {
  const current = await getCampaign(db, orgId, id);

  const criteria =
    patch.criteria === undefined ? undefined : validate(criteriaSchema, patch.criteria, "criteria");
  const thresholds =
    patch.thresholds === undefined ? undefined : validate(thresholdsSchema, patch.thresholds, "thresholds");
  const criteriaChanged = criteria !== undefined && !sameJson(criteria, current.criteria);

  const [row] = await db
    .update(campaigns)
    .set({
      ...patch,
      criteria,
      thresholds,
      rulesVersion: criteriaChanged ? sql`${campaigns.rulesVersion} + 1` : undefined,
      updatedAt: new Date(),
    })
    .where(and(eq(campaigns.organizationId, orgId), eq(campaigns.id, id)))
    .returning();
  if (!row) throw new NotFoundError("campaign", id);
  return row;
}

function validate<T>(
  schema: {
    safeParse(
      v: unknown,
    ):
      | { success: true; data: T }
      | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } };
  },
  value: unknown,
  field: string,
): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ValidationError(
      `invalid ${field}`,
      result.error.issues.map((i) => `${[field, ...i.path].join(".")}: ${i.message}`),
    );
  }
  return result.data;
}

/** Structural equality independent of key order (Zod re-emits keys in schema order). */
function sameJson(a: unknown, b: unknown): boolean {
  return canonical(a) === canonical(b);
}

function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v !== null && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v as Record<string, unknown>).sort(([x], [y]) => x.localeCompare(y)),
        )
      : v,
  );
}
