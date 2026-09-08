import { authed } from "../implementer.js";
import { notImplemented } from "../not-implemented.js";

export const campaigns = {
  list: authed.campaigns.list.handler(notImplemented),
  get: authed.campaigns.get.handler(notImplemented),
  draft: authed.campaigns.draft.handler(notImplemented),
  create: authed.campaigns.create.handler(notImplemented),
  update: authed.campaigns.update.handler(notImplemented),
  rescore: authed.campaigns.rescore.handler(notImplemented),
  previewRescore: authed.campaigns.previewRescore.handler(notImplemented),
};
