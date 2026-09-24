import type { LabeledExample } from "../db/labels.js";
import { truncate } from "../sources/text.js";

// Turn recent labels into balanced few-shot examples. Pure; tested.

export const EXAMPLE_MAX_CHARS = 600;

/**
 * Up to `limit` examples, alternating positive/negative from most recent, so one
 * side never dominates when both exist. Input is expected newest-first.
 */
export function selectFewShot(labels: readonly LabeledExample[], limit: number): LabeledExample[] {
  if (limit <= 0) return [];
  const positive = labels.filter((l) => l.label === "positive");
  const negative = labels.filter((l) => l.label === "negative");

  const out: LabeledExample[] = [];
  let p = 0;
  let n = 0;
  while (out.length < limit && (p < positive.length || n < negative.length)) {
    const pos = positive[p];
    const neg = negative[n];
    // Alternate, starting with whichever side is ahead in the "take next" order.
    if (pos && (out.length % 2 === 0 || !neg)) {
      out.push(pos);
      p += 1;
    } else if (neg) {
      out.push(neg);
      n += 1;
    }
  }
  return out;
}

export function formatExample(example: LabeledExample, index: number): string {
  const verdict = example.label === "positive" ? "GOOD FIT (won)" : "NOT A FIT (lost / not_fit)";
  const text = truncate(
    [example.post.title, example.post.body].filter(Boolean).join("\n"),
    EXAMPLE_MAX_CHARS,
  );
  const note = example.note ? `\nReviewer note: ${example.note}` : "";
  return `Example ${index + 1} — ${verdict} [${example.post.platform}]\n${text}${note}`;
}
