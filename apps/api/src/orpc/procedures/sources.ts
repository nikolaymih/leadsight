import { authed } from "../implementer.js";
import { notImplemented } from "../not-implemented.js";

export const sources = {
  list: authed.sources.list.handler(notImplemented),
  create: authed.sources.create.handler(notImplemented),
  update: authed.sources.update.handler(notImplemented),
  remove: authed.sources.remove.handler(notImplemented),
  run: authed.sources.run.handler(notImplemented),
};
