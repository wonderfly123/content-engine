import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

if (!process.env.DATABASE_URL) {
  // Soft-warn at import time; throwing here would break tooling that imports
  // the module without a live DB (e.g., drizzle-kit introspection of the
  // schema file does not need this, but other tools might).
  // Queries themselves will fail loudly when `neon` is called with undefined.
}

const sql = neon(process.env.DATABASE_URL ?? "");

export const db = drizzle(sql, { schema });
export { schema };
export type DB = typeof db;
