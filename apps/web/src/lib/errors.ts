import { isDefinedError, ORPCError } from "@orpc/client";
import { toast } from "sonner";

/** One toast format for every failed mutation: the oRPC code plus the server's message. */
export function toastError(err: unknown, fallback = "Something went wrong"): void {
  if (err instanceof ORPCError || isDefinedError(err)) {
    const e = err as ORPCError<string, unknown>;
    toast.error(`${e.code}: ${e.message || fallback}`);
    return;
  }
  toast.error(err instanceof Error ? err.message : fallback);
}
