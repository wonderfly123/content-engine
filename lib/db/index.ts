import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

// Standard Postgres driver, so the same code runs against Supabase (or any Postgres).
// `prepare: false` keeps it compatible with Supabase's transaction pooler as well as the session pooler.
// The client connects lazily, so importing this module without DATABASE_URL (tooling, tests) is safe;
// queries fail loudly instead.
const globalForDb = globalThis as unknown as { __ceSql?: ReturnType<typeof postgres> };

const client =
  globalForDb.__ceSql ??
  postgres(process.env.DATABASE_URL ?? "", { prepare: false, max: 5, idle_timeout: 20 });

// Next.js dev reloads modules on every change; reuse one pool instead of leaking connections.
if (process.env.NODE_ENV !== "production") globalForDb.__ceSql = client;

export const db = drizzle(client, { schema });
export { schema };
export type DB = typeof db;

/** Rows from a raw `db.execute(...)`, whichever shape the driver returns (array, or `{ rows }`). */
export function rowsOf<T = Record<string, unknown>>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  return ((result as { rows?: T[] } | null)?.rows ?? []) as T[];
}
