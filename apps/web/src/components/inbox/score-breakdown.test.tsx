import { render } from "@testing-library/react";
import type { Criterion, Evidence } from "@/lib/types";
import { formatEvidenceValue, ScoreBreakdown } from "./score-breakdown";

const criteria: Criterion[] = [
  { key: "hiring", question: "Are they hiring developers?", type: "boolean", weight: 40 },
  {
    key: "budget",
    question: "Stated budget",
    type: "enum",
    weight: 60,
    options: ["none", "some", "large"],
    points: { none: 0, some: 30, large: 60 },
  },
];

const evidence: Evidence = {
  criteria: {
    hiring: { value: true, quote: "we need two more devs", confidence: 90 },
    budget: { value: "some", quote: null, confidence: 55 },
  },
  disqualifier_hits: ["agency"],
  summary: "Small team hiring.",
};

describe("ScoreBreakdown", () => {
  it("shows points over possible, values, quotes and disqualifier hits in campaign order", () => {
    const { getByText, getAllByRole } = render(
      <ScoreBreakdown criteria={criteria} breakdown={{ hiring: 40, budget: 30 }} evidence={evidence} />,
    );
    const rows = getAllByRole("row").slice(1); // skip header
    expect(rows[0]?.textContent).toContain("Are they hiring developers?");
    expect(rows[0]?.textContent).toContain("Yes");
    expect(rows[0]?.textContent).toContain("40 / 40");
    expect(rows[0]?.textContent).toContain("“we need two more devs”");
    expect(rows[1]?.textContent).toContain("30 / 60");
    expect(rows[1]?.textContent).toContain("55%");
    expect(getByText("Disqualified:")).toBeTruthy();
    expect(getByText("agency")).toBeTruthy();
  });

  it("still lists a scored key the campaign no longer has", () => {
    const { getAllByRole } = render(
      <ScoreBreakdown
        criteria={criteria}
        breakdown={{ hiring: 0, budget: 0, legacy_key: 10 }}
        evidence={{ ...evidence, disqualifier_hits: [] }}
      />,
    );
    const rows = getAllByRole("row").slice(1);
    expect(rows).toHaveLength(3);
    expect(rows[2]?.textContent).toContain("legacy_key");
    expect(rows[2]?.textContent).toContain("10");
    expect(rows[2]?.textContent).not.toContain("/");
  });
});

describe("formatEvidenceValue", () => {
  it("renders booleans, numbers, strings and null", () => {
    expect(formatEvidenceValue(true)).toBe("Yes");
    expect(formatEvidenceValue(false)).toBe("No");
    expect(formatEvidenceValue(12)).toBe("12");
    expect(formatEvidenceValue("some")).toBe("some");
    expect(formatEvidenceValue(null)).toBe("—");
  });
});
