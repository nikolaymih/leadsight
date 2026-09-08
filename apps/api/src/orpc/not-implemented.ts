import { ORPCError } from "@orpc/server";

/** Placeholder handler for contract procedures that have no implementation yet. Responds 501. */
export function notImplemented(): never {
  throw new ORPCError("NOT_IMPLEMENTED", { message: "This procedure is not implemented yet" });
}
