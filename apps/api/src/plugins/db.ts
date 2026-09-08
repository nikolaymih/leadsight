import { createDb, type Db } from "@leadsight/core";
import fp from "fastify-plugin";

declare module "fastify" {
  interface FastifyInstance {
    db: Db;
  }
}

export interface DbPluginOptions {
  databaseUrl: string;
}

// One pool per process. Migrations are not run here: they are a deploy step
// (`pnpm db:migrate`), so a bad migration cannot take the API down mid-rollout.
export const dbPlugin = fp<DbPluginOptions>(
  async (app, opts) => {
    const client = createDb(opts.databaseUrl);
    app.decorate("db", client.db);
    app.addHook("onClose", async () => {
      await client.close();
    });
  },
  { name: "db" },
);
