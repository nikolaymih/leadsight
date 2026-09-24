import { describe, expect, it } from "vitest";
import { createMemoryWebSearchBudgetStore, createWebSearchBudget } from "../../extractor/budget.js";
import {
  type SearchFailureKind,
  type SearchProvider,
  SearchProviderError,
  type SearchRequest,
} from "./provider.js";
import { AUTH_COOLDOWN_MS, createSearchRotator, WebSearchUnavailableError } from "./rotator.js";

const REQUEST: SearchRequest = {
  query: '"a" OR "b"',
  includeDomains: ["reddit.com"],
  since: new Date("2026-09-23T00:00:00Z"),
  maxResults: 20,
  platform: "reddit",
};

/** A fake provider: answers with one hit, or fails with the given kind; counts calls. */
function provider(name: string, behaviour: { fail?: SearchFailureKind; units?: number } = {}) {
  const p = {
    name,
    calls: 0,
    fail: behaviour.fail,
    async search() {
      p.calls += 1;
      if (p.fail) throw new SearchProviderError(name, `${name} ${p.fail}`, p.fail);
      return {
        hits: [{ url: `https://www.reddit.com/r/a/comments/${name}/t/`, raw: {} }],
        units: behaviour.units ?? 1,
      };
    },
  };
  return p satisfies SearchProvider & { calls: number };
}

function budget(caps: Record<string, number | null>, clock: { now: Date }) {
  const store = createMemoryWebSearchBudgetStore(() => clock.now);
  return { store, budget: createWebSearchBudget({ store, caps, now: () => clock.now }) };
}

describe("search rotator", () => {
  it("rotates between providers under budget and reports the units of the one that answered", async () => {
    const exa = provider("exa");
    const tavily = provider("tavily", { units: 2 });
    const rotator = createSearchRotator({ providers: [exa, tavily] });

    const first = await rotator.search(REQUEST);
    const second = await rotator.search(REQUEST);
    const third = await rotator.search(REQUEST);
    expect([first, second, third].map((r) => ("skipped" in r ? "skip" : r.provider))).toEqual([
      "exa",
      "tavily",
      "exa",
    ]);
    expect(second).toMatchObject({ usage: [{ provider: "tavily", units: 2 }] });
  });

  it("prefers a provider under 90% over one in back-off, and never calls one at 100%", async () => {
    const clock = { now: new Date("2026-09-24T10:00:00Z") };
    const { store, budget: b } = budget({ exa: 100, tavily: 100 }, clock);
    const exa = provider("exa");
    const tavily = provider("tavily");
    const rotator = createSearchRotator({ providers: [exa, tavily], budget: b, now: () => clock.now });

    await store.record("org", "exa", 90); // exa in back-off
    for (let i = 0; i < 4; i++) await rotator.search(REQUEST);
    expect(exa.calls).toBe(0);
    expect(tavily.calls).toBe(4);

    await store.record("org", "tavily", 95); // both in back-off: rotation resumes between them
    for (let i = 0; i < 4; i++) await rotator.search(REQUEST);
    expect(exa.calls).toBe(2);
    expect(tavily.calls).toBe(6);

    await store.record("org", "exa", 10); // exa at 100%: hard stop
    for (let i = 0; i < 3; i++) await rotator.search(REQUEST);
    expect(exa.calls).toBe(2);
    expect(tavily.calls).toBe(9);

    await store.record("org", "tavily", 5); // both at 100%: skipped, nobody called
    const out = await rotator.search(REQUEST);
    expect(out).toMatchObject({ skipped: true, reason: expect.stringMatching(/monthly cap/) });
    expect(exa.calls + tavily.calls).toBe(11);

    // A new UTC month resets both counters.
    clock.now = new Date("2026-10-01T00:00:01Z");
    expect("skipped" in (await rotator.search(REQUEST))).toBe(false);
  });

  it("falls through to the next provider on failure and cools the failed one down", async () => {
    const clock = { now: new Date("2026-09-24T10:00:00Z") };
    const exa = provider("exa", { fail: "quota" });
    const tavily = provider("tavily");
    const rotator = createSearchRotator({ providers: [exa, tavily], now: () => clock.now });

    const out = await rotator.search(REQUEST);
    expect(out).toMatchObject({ provider: "tavily", usage: [{ provider: "tavily", units: 1 }] });
    expect(exa.calls).toBe(1);

    // Quota cooldown lasts until the next UTC month, even if the provider would now answer.
    exa.fail = undefined;
    for (let i = 0; i < 3; i++) await rotator.search(REQUEST);
    expect(exa.calls).toBe(1);
    clock.now = new Date("2026-10-01T00:00:00Z");
    await rotator.search(REQUEST);
    await rotator.search(REQUEST);
    expect(exa.calls).toBe(2);
  });

  it("auth failures cool down for an hour; transient ones not at all", async () => {
    const clock = { now: new Date("2026-09-24T10:00:00Z") };
    const exa = provider("exa", { fail: "auth" });
    const tavily = provider("tavily", { fail: "transient" });
    const rotator = createSearchRotator({ providers: [exa, tavily], now: () => clock.now });

    const err = await rotator.search(REQUEST).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WebSearchUnavailableError);
    expect((err as WebSearchUnavailableError).failures.map((f) => [f.provider, f.failure])).toEqual([
      ["exa", "auth"],
      ["tavily", "transient"],
    ]);
    expect((err as WebSearchUnavailableError).retryable).toBe(true);

    tavily.fail = undefined;
    await rotator.search(REQUEST);
    await rotator.search(REQUEST);
    expect(exa.calls).toBe(1);
    expect(tavily.calls).toBe(3);

    clock.now = new Date(clock.now.getTime() + AUTH_COOLDOWN_MS + 1);
    exa.fail = undefined;
    await rotator.search(REQUEST);
    await rotator.search(REQUEST);
    expect(exa.calls).toBe(2);
  });

  it("skips when no provider is configured", async () => {
    expect(await createSearchRotator({ providers: [] }).search(REQUEST)).toEqual({
      skipped: true,
      reason: "no web search provider configured",
    });
  });
});
