import { patchLeadDetail, patchLeadsInList } from "./lead-cache";
import type { LeadListPage, LeadSummary } from "./types";

function lead(id: string, status: LeadSummary["status"] = "new"): LeadSummary {
  return {
    id,
    campaignId: "c1",
    verdict: "hot",
    score: 90,
    confidence: 80,
    summary: "s",
    status,
    assigneeId: null,
    scoredAt: "2026-09-08T00:00:00.000Z",
    post: {
      id: `p-${id}`,
      platform: "reddit",
      url: "https://reddit.com/x",
      authorHandle: "a",
      title: "t",
      postedAt: null,
    },
  };
}

describe("patchLeadsInList", () => {
  it("patches matching leads across infinite pages and leaves others alone", () => {
    const data = {
      pages: [
        { items: [lead("a"), lead("b")], nextCursor: "x" },
        { items: [lead("c")], nextCursor: null },
      ] satisfies LeadListPage[],
      pageParams: [undefined, "x"],
    };
    const out = patchLeadsInList(["a", "c"], { status: "reviewed", assigneeId: "u1" })(data) as typeof data;
    expect(out.pages[0]?.items.map((l) => l.status)).toEqual(["reviewed", "new"]);
    expect(out.pages[1]?.items[0]).toMatchObject({ status: "reviewed", assigneeId: "u1" });
    expect(out.pageParams).toBe(data.pageParams);
    // Untouched leads keep identity so React rows don't re-render.
    expect(out.pages[0]?.items[1]).toBe(data.pages[0]?.items[1]);
  });

  it("handles a plain page and passes through unknown shapes", () => {
    const page: LeadListPage = { items: [lead("a")], nextCursor: null };
    expect((patchLeadsInList(["a"], { status: "won" })(page) as LeadListPage).items[0]?.status).toBe("won");
    expect(patchLeadsInList(["a"], { status: "won" })(undefined)).toBeUndefined();
  });
});

describe("patchLeadDetail", () => {
  it("only patches detail-shaped data", () => {
    const detail = { ...lead("a"), evidence: { criteria: {}, disqualifier_hits: [], summary: "" } };
    expect(patchLeadDetail({ status: "lost" })(detail)).toMatchObject({ status: "lost" });
    expect(patchLeadDetail({ status: "lost" })(lead("a"))).toMatchObject({ status: "new" });
  });
});
