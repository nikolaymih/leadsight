import { type AnyColumn, and, or, type SQL, sql } from "drizzle-orm";
import type { z } from "zod";
import { ValidationError } from "../errors.js";

// Opaque cursors for keyset pagination. Never offsets.

export function encodeCursor(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

export function decodeCursor<T>(cursor: string, schema: z.ZodType<T>): T {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    throw new ValidationError("invalid cursor");
  }
  const result = schema.safeParse(parsed);
  if (!result.success) throw new ValidationError("invalid cursor");
  return result.data;
}

export type Direction = "asc" | "desc";

export interface KeyPart {
  column: AnyColumn;
  direction: Direction;
  /** A bound parameter, or `sql` for values needing a cast (e.g. `${raw}::timestamptz`). */
  value: unknown;
}

/**
 * Rows strictly after the cursor row in the given sort order:
 * (k1 > v1) OR (k1 = v1 AND k2 > v2) OR … with `<` for descending parts.
 */
export function keysetAfter(parts: readonly KeyPart[]): SQL | undefined {
  const clauses = parts.map((part, i) => {
    const equalBefore = parts.slice(0, i).map((p) => sql`${p.column} = ${p.value}`);
    const beyond =
      part.direction === "asc" ? sql`${part.column} > ${part.value}` : sql`${part.column} < ${part.value}`;
    return and(...equalBefore, beyond);
  });
  return or(...clauses);
}
