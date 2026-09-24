"use client";

import { useQueryStates } from "nuqs";
import { inboxParsers } from "@/lib/inbox-params";

/** Inbox filters and selection, all in the URL. */
export function useInboxFilters() {
  return useQueryStates(inboxParsers, { history: "replace" });
}
