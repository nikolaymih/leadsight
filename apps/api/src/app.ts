import cors from "@fastify/cors";
import Fastify, { type FastifyServerOptions } from "fastify";
import type { Env } from "./env.js";
import { authPlugin } from "./plugins/auth.js";
import { dbPlugin } from "./plugins/db.js";
import { orpcPlugin } from "./plugins/orpc.js";
import { pipelinePlugin } from "./plugins/pipeline.js";
import { schedulerPlugin } from "./plugins/scheduler.js";
import { healthRoutes } from "./routes/health.js";

// Register order is fixed: cors → db → auth → pipeline → orpc → scheduler → routes.
// Register nothing elsewhere.
export async function buildApp(env: Env) {
  const app = Fastify({
    logger: loggerOptions(env),
    // Campaign drafts can carry pasted page text.
    bodyLimit: 1_048_576,
    trustProxy: env.NODE_ENV === "production",
  });

  await app.register(cors, { origin: env.WEB_ORIGIN, credentials: true });
  await app.register(dbPlugin, { databaseUrl: env.DATABASE_URL });
  await app.register(authPlugin, { env });
  await app.register(pipelinePlugin, { env });
  await app.register(orpcPlugin);
  await app.register(schedulerPlugin, { enabled: env.SCHEDULER_ENABLED, cron: env.SCHEDULER_CRON });
  await app.register(healthRoutes);

  return app;
}

export type App = Awaited<ReturnType<typeof buildApp>>;

function loggerOptions(env: Env): FastifyServerOptions["logger"] {
  return {
    level: env.LOG_LEVEL,
    redact: ["req.headers.authorization", "req.headers.cookie", "req.headers['x-api-key']"],
    ...(env.NODE_ENV === "development" ? { transport: { target: "pino-pretty" } } : {}),
  };
}
