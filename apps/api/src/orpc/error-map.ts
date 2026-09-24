import { BudgetExhaustedError, NotFoundError, ProviderError, ValidationError } from "@leadsight/core";
import { ORPCError, os } from "@orpc/server";
import type { Context } from "./context.js";

// The one place core's typed errors become oRPC errors. Handlers never map inline.

export const mapCoreErrors = os.$context<Context>().middleware(async ({ next }) => {
  try {
    return await next();
  } catch (err) {
    if (err instanceof ORPCError) throw err;
    if (err instanceof NotFoundError) throw new ORPCError("NOT_FOUND", { message: err.message, cause: err });
    if (err instanceof ValidationError) {
      throw new ORPCError("BAD_REQUEST", { message: err.message, data: { issues: err.issues }, cause: err });
    }
    if (err instanceof BudgetExhaustedError) {
      throw new ORPCError("SERVICE_UNAVAILABLE", { message: err.message, cause: err });
    }
    if (err instanceof ProviderError) {
      throw new ORPCError("BAD_GATEWAY", {
        message: err.message,
        data: { provider: err.provider },
        cause: err,
      });
    }
    throw err;
  }
});
