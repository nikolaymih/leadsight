import { contract } from "@leadsight/contract";
import { implement } from "@orpc/server";
import { type Context, requireOrg } from "./context.js";

// Contract-first implementer. Procedures are built from `authed`; `os` is only
// for the router itself and for anything that must deliberately skip auth (nothing yet).
export const os = implement(contract).$context<Context>();
export const authed = os.use(requireOrg);
