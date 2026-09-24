import { describe, expect, it } from "vitest";
import { createTick } from "./scheduler.js";

function logger() {
  const warnings: string[] = [];
  const errors: string[] = [];
  return {
    warnings,
    errors,
    warn: (_obj: Record<string, unknown>, msg: string) => {
      warnings.push(msg);
    },
    error: (_obj: Record<string, unknown>, msg: string) => {
      errors.push(msg);
    },
  };
}

describe("scheduler tick", () => {
  it("skips a tick while the previous run is still in progress", async () => {
    // First run blocks until released; later runs resolve immediately.
    let release: () => void = () => {};
    let calls = 0;
    const run = () =>
      new Promise<void>((resolve) => {
        calls += 1;
        if (calls === 1) release = resolve;
        else resolve();
      });
    const log = logger();
    const tick = createTick(run, log);

    const first = tick.tick();
    expect(tick.isRunning()).toBe(true);
    expect(await tick.tick()).toBe("skipped");
    expect(log.warnings).toEqual(["pipeline tick skipped: previous run still in progress"]);

    release();
    expect(await first).toBe("ran");
    expect(tick.isRunning()).toBe(false);
    expect(await tick.tick()).toBe("ran");
    expect(calls).toBe(2);
  });

  it("never throws out of a tick; failures are logged and the mutex is released", async () => {
    const log = logger();
    const tick = createTick(async () => {
      throw new Error("db down");
    }, log);

    expect(await tick.tick()).toBe("failed");
    expect(log.errors).toEqual(["pipeline tick failed"]);
    expect(tick.isRunning()).toBe(false);
  });
});
