import { runPipeline } from "@leadsight/core";
import fp from "fastify-plugin";
import * as cron from "node-cron";

// One cron job runs the whole pipeline; it picks the due sources itself. Ticks never
// overlap and never throw: a running tick makes the next one a no-op.

export interface SchedulerOptions {
  enabled: boolean;
  cron: string;
}

export type TickOutcome = "ran" | "skipped" | "failed";

export interface Tick {
  tick(): Promise<TickOutcome>;
  isRunning(): boolean;
}

interface TickLogger {
  warn(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

export function createTick(run: () => Promise<unknown>, log: TickLogger): Tick {
  let running = false;
  return {
    isRunning: () => running,
    async tick() {
      if (running) {
        log.warn({}, "pipeline tick skipped: previous run still in progress");
        return "skipped";
      }
      running = true;
      try {
        await run();
        return "ran";
      } catch (err) {
        log.error({ err }, "pipeline tick failed");
        return "failed";
      } finally {
        running = false;
      }
    },
  };
}

export const schedulerPlugin = fp<SchedulerOptions>(
  async (app, opts) => {
    if (!opts.enabled) {
      app.log.info({}, "scheduler disabled");
      return;
    }

    const tick = createTick(() => runPipeline(app.pipeline), app.log);
    let task: ReturnType<typeof cron.schedule> | undefined;

    app.addHook("onReady", async () => {
      task = cron.schedule(opts.cron, () => {
        // Fire-and-forget by design: tick() handles overlap and errors itself.
        void tick.tick();
      });
      app.log.info({ cron: opts.cron }, "scheduler started");
    });
    app.addHook("onClose", async () => {
      await task?.stop();
    });
  },
  { name: "scheduler", dependencies: ["pipeline"] },
);
