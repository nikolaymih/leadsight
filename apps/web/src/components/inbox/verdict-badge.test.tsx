import { render } from "@testing-library/react";
import { VERDICTS } from "@/lib/types";
import { VerdictBadge } from "./verdict-badge";

describe("VerdictBadge", () => {
  it.each(VERDICTS)("renders %s with its own token class", (verdict) => {
    const { getByText } = render(<VerdictBadge verdict={verdict} />);
    const el = getByText(verdict);
    expect(el.dataset.verdict).toBe(verdict);
    expect(el.className).toContain(`text-verdict-${verdict}`);
  });
});
