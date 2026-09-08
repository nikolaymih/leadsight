import { authed } from "../implementer.js";
import { notImplemented } from "../not-implemented.js";

export const runs = {
  list: authed.runs.list.handler(notImplemented),
  budget: authed.runs.budget.handler(notImplemented),
};
