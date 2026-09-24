import { buildApp } from "./app.js";
import { loadEnv } from "./env.js";

const SHUTDOWN_DEADLINE_MS = 10_000;

const env = loadEnv();
const app = await buildApp(env);

function shutdown(signal: NodeJS.Signals) {
  app.log.info({ signal }, "shutting down");
  const deadline = setTimeout(() => {
    app.log.error({ signal }, "shutdown deadline exceeded, exiting");
    process.exit(1);
  }, SHUTDOWN_DEADLINE_MS);
  deadline.unref();

  app.close().then(
    () => process.exit(0),
    (err: unknown) => {
      app.log.error({ err }, "error during shutdown");
      process.exit(1);
    },
  );
}

process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);

try {
  await app.listen({ port: env.PORT, host: env.HOST });
} catch (err) {
  app.log.error({ err }, "failed to start");
  process.exit(1);
}
