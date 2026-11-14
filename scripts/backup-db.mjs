/**
 * Read-only backup of every table in the `public` schema to one JSON file per table.
 * Usage: node scripts/backup-db.mjs <output-folder>
 * The folder must be outside the repo: the files hold real data (tokens stay encrypted).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".env.local" });

const out = process.argv[2];
if (!out) throw new Error("give an output folder");
const target = path.resolve(out);
if (target.startsWith(process.cwd() + path.sep)) throw new Error("the output folder must be outside the repo");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set in .env.local");

const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });
try {
  mkdirSync(target, { recursive: true });
  const tables = await sql`select tablename from pg_tables where schemaname = 'public' order by tablename`;
  const summary = {};
  for (const { tablename } of tables) {
    const rows = await sql`select * from ${sql(`public.${tablename}`)}`;
    writeFileSync(path.join(target, `${tablename}.json`), JSON.stringify(rows, null, 1));
    summary[tablename] = rows.length;
  }
  writeFileSync(path.join(target, "_summary.json"), JSON.stringify({ takenAt: new Date().toISOString(), rows: summary }, null, 1));
  console.log(JSON.stringify(summary));
} finally {
  await sql.end();
}
