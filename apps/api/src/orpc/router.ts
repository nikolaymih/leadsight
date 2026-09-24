import { os } from "./implementer.js";
import { campaigns } from "./procedures/campaigns.js";
import { integrations } from "./procedures/integrations.js";
import { leads } from "./procedures/leads.js";
import { runs } from "./procedures/runs.js";
import { sources } from "./procedures/sources.js";

// The compiler fails here if a contract procedure has no implementation.
export const router = os.router({ campaigns, sources, leads, runs, integrations });

export type Router = typeof router;
