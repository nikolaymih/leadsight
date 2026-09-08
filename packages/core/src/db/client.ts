import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../schema/index.js";

export type Db = PostgresJsDatabase<typeof schema>;
/** The `tx` handed to a `db.transaction(async (tx) => …)` callback. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
/** Query functions accept either, so callers can compose them inside a transaction. */
export type DbLike = Db | Tx;

export interface DbClient {
  db: Db;
  close(): Promise<void>;
}

export interface CreateDbOptions {
  /** Pool size. Default 10. */
  max?: number;
}

/** One pool per process. The caller owns its lifetime and calls `close()` on shutdown. */
export function createDb(url: string, opts: CreateDbOptions = {}): DbClient {
  const sql = postgres(url, { max: opts.max ?? 10, idle_timeout: 20 });
  return {
    db: drizzle(sql, { schema }),
    close: () => sql.end({ timeout: 5 }),
  };
}
