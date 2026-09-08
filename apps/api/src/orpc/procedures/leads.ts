import { authed } from "../implementer.js";
import { notImplemented } from "../not-implemented.js";

export const leads = {
  list: authed.leads.list.handler(notImplemented),
  get: authed.leads.get.handler(notImplemented),
  update: authed.leads.update.handler(notImplemented),
  bulkUpdate: authed.leads.bulkUpdate.handler(notImplemented),
  addNote: authed.leads.addNote.handler(notImplemented),
};
