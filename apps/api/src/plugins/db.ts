import { schema } from "@leadsight/core";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import fp from "fastify-plugin";
import postgres from "postgres";

export type Db = PostgresJsDatabase<typeof schema>;

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
    const client = postgres(opts.databaseUrl, { max: 10, idle_timeout: 20 });
    app.decorate("db", drizzle(client, { schema }));
    app.addHook("onClose", async () => {
      await client.end({ timeout: 5 });
    });
  },
  { name: "db" },
);
