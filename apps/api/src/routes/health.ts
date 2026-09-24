import { sql } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";

// Plain Fastify, no auth. Used by the hosting machine's process manager.
export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get("/healthz", async (_request, reply) => {
    try {
      await app.db.execute(sql`select 1`);
      return { ok: true, db: "up" };
    } catch (err) {
      app.log.error({ err }, "healthz: database check failed");
      return reply.status(503).send({ ok: false, db: "down" });
    }
  });
};
