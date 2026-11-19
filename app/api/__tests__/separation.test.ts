/**
 * Proof of separation: two workspaces in a real (in-memory) database, and every API route and
 * server action tried by one against the other.
 *
 * - Every route file and method under app/api must have an attempt (a new route without one fails).
 * - As the attacker, each attempt must be refused, must leak nothing of the victim's, and must
 *   leave the victim's rows untouched.
 * - As the victim, the same request must not be refused, which proves the request was valid and
 *   the refusal came from the ownership check.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { getTableColumns, getTableName, is, sql } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Access } from "@/lib/auth/access";
import * as schema from "@/lib/db/schema";
import type { RouteRequest } from "./separation/attacks";
import { ACTION_ATTACKS, ROUTE_ATTACKS } from "./separation/index";
import { seedEditorJob, seedWorkspace, snapshot, tableNames, victimStrings, type Seeded, type TestDb } from "./separation/world";

const state = vi.hoisted(() => {
  process.env.DATABASE_URL ??= "postgres://test:test@localhost/test";
  process.env.TOKEN_ENCRYPTION_KEY ??= "0000000000000000000000000000000000000000000000000000000000000000";
  process.env.CRON_SECRET = "test-cron-secret";
  for (const key of ["ANTHROPIC_API_KEY", "BLOB_READ_WRITE_TOKEN", "SALESMSG_API_TOKEN", "SALESMSG_TEAM_ID", "SALESMSG_PHONE_NUMBER", "SALESMSG_WEBHOOK_SECRET", "APP_URL", "R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"]) delete process.env[key];
  // Never the real jobs folder: if a reel route lost its check, the test must not reach real files.
  process.env.VIDEO_JOBS_DIR = "/nonexistent/separation-test-jobs";
  return { current: null as unknown };
});

vi.mock("@/lib/db", async () => {
  const actual = await vi.importActual<typeof import("@/lib/db")>("@/lib/db");
  const { makeTestDb } = await import("./separation/world");
  return { ...actual, db: await makeTestDb() };
});
vi.mock("@/lib/auth/session", () => ({
  getAccess: async () => state.current,
  requireAdmin: async () => {
    const access = state.current as Access | null;
    if (!access || access.status !== "active" || access.role !== "admin") throw new Error("Admins only.");
    return access;
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));

const ROOT = path.resolve(__dirname, "../../..");
const REFUSED = [401, 403, 404];
const METHODS = ["GET", "POST", "PATCH", "PUT", "DELETE"] as const;

function walk(dir: string, keep: (file: string) => boolean): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".") || entry.name === "__tests__") continue;
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...walk(rel, keep));
    else if (keep(rel)) out.push(rel);
  }
  return out;
}

const routeFiles = walk("app/api", (f) => f.endsWith("/route.ts"));
const cronRoutes = routeFiles.filter((f) => f.startsWith("app/api/cron/"));
const userRoutes = routeFiles.filter((f) => !f.startsWith("app/api/cron/"));
const methodsOf = (file: string) => METHODS.filter((m) => new RegExp(`export\\s+(?:async\\s+function|const)\\s+${m}\\b`).test(readFileSync(path.join(ROOT, file), "utf8")));
const actionFiles = [...walk("app", (f) => /\.tsx?$/.test(f)), ...walk("lib", (f) => /\.tsx?$/.test(f))].filter((f) => /^\s*["']use server["']/.test(readFileSync(path.join(ROOT, f), "utf8").replace(/^(\s*(\/\/.*|\/\*[\s\S]*?\*\/))*\s*/, "")));
const actionsOf = (file: string) => [...readFileSync(path.join(ROOT, file), "utf8").matchAll(/export\s+async\s+function\s+(\w+)/g)].map((m) => m[1]);

let db: TestDb;
let attacker: Seeded;
let victim: Seeded;

const as = (who: Seeded | null) => {
  state.current = who?.user ?? null;
};

/** The victim's rows: every row, in any table, that mentions one of their ids or their marker. */
async function victimRows(): Promise<Record<string, string[]>> {
  const needles = victimStrings(victim);
  const out: Record<string, string[]> = {};
  for (const [table, json] of Object.entries(await snapshot(db))) {
    out[table] = (JSON.parse(json) as unknown[]).map((row) => JSON.stringify(row)).filter((row) => needles.some((n) => row.includes(n)));
  }
  return out;
}

function leaks(text: string): string[] {
  return victimStrings(victim).filter((needle) => text.includes(needle));
}

async function callRoute(route: string, method: string, request: RouteRequest): Promise<Response> {
  const mod = (await import(/* @vite-ignore */ path.join(ROOT, route))) as Record<string, (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>>;
  const params = request.params ?? {};
  const pathname = route
    .replace(/^app/, "")
    .replace(/\/route\.ts$/, "")
    .replace(/\[(\w+)\]/g, (_, key: string) => encodeURIComponent(params[key] ?? "missing"));
  const url = new URL(`http://localhost${pathname}`);
  for (const [k, v] of Object.entries(request.query ?? {})) url.searchParams.set(k, v);
  const init: { method: string; body?: BodyInit; headers?: Record<string, string> } = { method };
  if (request.form) {
    const form = new FormData();
    for (const [k, v] of Object.entries(request.form)) form.set(k, v);
    init.body = form;
  } else if (request.body !== undefined) {
    init.body = JSON.stringify(request.body);
    init.headers = { "content-type": "application/json" };
  }
  return mod[method](new NextRequest(url, init), { params: Promise.resolve(params) });
}

beforeEach(async () => {
  db = (await import("@/lib/db")).db as unknown as TestDb;
  vi.stubGlobal("fetch", async () => {
    throw new Error("the network is off in tests");
  });
  const names = (await tableNames(db)).map((n) => `"${n}"`).join(", ");
  await db.execute(sql.raw(`truncate table ${names} cascade`));
  attacker = await seedWorkspace(db, "Attacker", "00000000-0000-4000-8000-00000000000a");
  victim = await seedWorkspace(db, "VICTIMDATA", "00000000-0000-4000-8000-00000000000b");
  await seedEditorJob(db, attacker, "Attacker");
  await seedEditorJob(db, victim, "VICTIMDATA");
});

describe("coverage", () => {
  it("has an attempt for every route and method", () => {
    const covered = new Set(ROUTE_ATTACKS.map((a) => `${a.method} ${a.route}`));
    const missing = userRoutes.flatMap((file) => methodsOf(file).map((m) => `${m} ${file}`)).filter((key) => !covered.has(key));
    expect(missing).toEqual([]);
  });

  it("has an attempt for every server action", () => {
    const covered = new Set(ACTION_ATTACKS.map((a) => `${a.file}#${a.action}`));
    const missing = actionFiles.flatMap((file) => actionsOf(file).map((name) => `${file}#${name}`)).filter((key) => !covered.has(key));
    expect(missing).toEqual([]);
  });

  it("gives every table a brand, apart from the few that reach one another way", () => {
    const viaAnotherTable = [
      "workspaces", "workspace_members", "workspace_credentials", "brands", "draft_assets",
      // Conversations reach their workspace directly (a thread can start before its brand is known),
      // through requireConversation (lib/conversations/access.ts); messages reach it through their
      // conversation; a member's phone belongs to the user, not to any workspace.
      "conversations", "conversation_messages", "member_phones",
      // Media objects on R2 reach their workspace directly too (a clip can arrive before the thread
      // has a brand): by id through requireMedia (lib/media/access.ts), inside a thread through
      // requireConversation plus requireConversationMedia; their keys start with the workspace.
      "media_objects",
      // The editor skill's versions belong to the platform, not to any workspace: platform admin only
      // (app/api/admin/skill), and every workspace's jobs run on the current set.
      "editor_skill_versions",
      // Platform-wide settings (the fallback raw clip retention); no route writes them today, and each
      // brand's own choice lives on brands.settings_json (app/api/brands/[id]/storage).
      "platform_settings",
      // The editor's music library: platform tracks (admin only, app/api/admin/music) or one workspace's own
      // (workspace_id); an editor job only gets, and its callback only accepts, the platform's or its own.
      "music_tracks",
    ];
    const missing = (Object.values(schema) as unknown[])
      .filter((t): t is PgTable => is(t, PgTable))
      .filter((t) => !("brandId" in getTableColumns(t)))
      .map((t) => getTableName(t))
      .filter((name) => !viaAnotherTable.includes(name));
    expect(missing).toEqual([]);
  });
});

describe("one workspace against another: routes", () => {
  it.each(ROUTE_ATTACKS.map((a) => [`${a.method} ${a.route}${a.name ? ` (${a.name})` : ""}`, a] as const))("%s", async (_label, attack) => {
    const request = attack.build(victim, attacker);
    const before = await victimRows();

    as(attacker);
    const refused = await callRoute(attack.route, attack.method, request);
    const text = await refused.text();
    if (!attack.attackerMayPass) expect(REFUSED, `attacker got ${refused.status}: ${text.slice(0, 300)}`).toContain(refused.status);
    expect(leaks(text)).toEqual([]);
    expect(await victimRows()).toEqual(before);

    as(null);
    const anonymous = await callRoute(attack.route, attack.method, request);
    expect(REFUSED).toContain(anonymous.status);

    if (attack.skipOwnerControl) return;
    as(victim);
    let status: number;
    try {
      status = (await callRoute(attack.route, attack.method, request)).status;
    } catch {
      status = 500; // got past the check and failed on something else (network is off)
    }
    expect(REFUSED, `the victim's own request was refused with ${status}; the attempt is not a valid request`).not.toContain(status);
  });
});

describe("one workspace against another: server actions", () => {
  it.each(ACTION_ATTACKS.map((a) => [`${a.file}#${a.action}${a.name ? ` (${a.name})` : ""}`, a] as const))("%s", async (_label, attack) => {
    const mod = (await import(/* @vite-ignore */ path.join(ROOT, attack.file))) as Record<string, (...args: unknown[]) => Promise<unknown>>;
    const before = await victimRows();

    as(attacker);
    let result: unknown;
    try {
      result = await mod[attack.action](...attack.args(victim, attacker));
    } catch (err) {
      result = { ok: false, error: (err as Error).message };
    }
    if (!attack.attackerMayPass) expect(result, "attacker's call must fail").toMatchObject({ ok: false });
    expect(leaks(JSON.stringify(result))).toEqual([]);
    expect(await victimRows()).toEqual(before);

    if (attack.skipOwnerControl) return;
    as(victim);
    let own: unknown;
    try {
      own = await mod[attack.action](...attack.args(victim, attacker));
    } catch (err) {
      own = { ok: true, threw: (err as Error).message }; // got past the check and failed on something else
    }
    expect(own, "the victim's own call was refused; the attempt is not a valid call").not.toMatchObject({ ok: false });
  });
});

describe("cron routes", () => {
  it.each(cronRoutes)("%s refuses a call without the cron secret", async (route) => {
    const res = await callRoute(route, "GET", {});
    expect(res.status).toBe(401);
  });
});
