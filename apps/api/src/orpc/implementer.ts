import { contract } from "@leadsight/contract";
import { implement } from "@orpc/server";
import { type Context, requireOrg, requireRole } from "./context.js";
import { mapCoreErrors } from "./error-map.js";

// Contract-first implementer. Build procedures from `authed` (any member of the active
// org), `admin` or `owner`. `os` itself is only for the router.
export const os = implement(contract).$context<Context>();
export const authed = os.use(mapCoreErrors).use(requireOrg);
export const admin = authed.use(requireRole("admin"));
export const owner = authed.use(requireRole("owner"));
