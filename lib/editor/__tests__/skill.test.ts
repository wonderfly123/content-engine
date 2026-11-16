/**
 * Admin > Editor skill: the bundled defaults match workers/editor/skill, the editable list matches
 * the worker's, and the admin API (guard, path checks, versions that only ever add rows).
 * In-memory database; Supabase is mocked (names fall back to ids).
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { seedWorkspace, tableNames, type Seeded, type TestDb } from "@/app/api/__tests__/separation/world";
import type { Access } from "@/lib/auth/access";
import * as schema from "@/lib/db/schema";

const state = vi.hoisted(() => {
  process.env.DATABASE_URL ??= "postgres://test:test@localhost/test";
  process.env.TOKEN_ENCRYPTION_KEY ??= "0000000000000000000000000000000000000000000000000000000000000000";
  return { current: null as unknown };
});
vi.mock("@/lib/db", async () => {
  const actual = await vi.importActual<typeof import("@/lib/db")>("@/lib/db");
  const { makeTestDb } = await import("@/app/api/__tests__/separation/world");
  return { ...actual, db: await makeTestDb() };
});
vi.mock("@/lib/auth/session", () => ({ getAccess: async () => state.current }));
vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: () => ({ auth: { admin: { getUserById: async (id: string) => ({ data: { user: { id, email: `${id.slice(-1)}@example.test` } } }) } } }),
}));

import { GET as filesRoute, POST as changeRoute } from "@/app/api/admin/skill/route";
import { GET as historyRoute } from "@/app/api/admin/skill/history/route";
import { SKILL_DEFAULTS } from "@/lib/editor/skill-defaults.generated";
import { EDITABLE_SKILL_PATHS, MAX_SKILL_FILE_BYTES } from "@/lib/editor/skill-files";
import { currentSkillFiles } from "@/lib/editor/skill-store";

const ROOT = path.resolve(__dirname, "../../..");
const SKILL = path.join(ROOT, "workers/editor/skill");

function markdownIn(dir: string, rel = ""): string[] {
  return readdirSync(path.join(dir, rel), { withFileTypes: true }).flatMap((e) => {
    const p = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) return p === "scripts" ? [] : markdownIn(dir, p);
    return e.name.endsWith(".md") ? [p] : [];
  });
}

describe("bundled skill defaults", () => {
  it("cover exactly the markdown files in workers/editor/skill (scripts excluded)", () => {
    expect(Object.keys(SKILL_DEFAULTS).sort()).toEqual(markdownIn(SKILL).sort());
    expect([...EDITABLE_SKILL_PATHS].sort()).toEqual(markdownIn(SKILL).sort());
  });

  it.each(markdownIn(SKILL))("%s matches the repo copy (run `npm run skill:gen` after editing the skill)", (file) => {
    expect(SKILL_DEFAULTS[file]).toBe(readFileSync(path.join(SKILL, file), "utf8"));
  });

  it("lists the same editable paths and limits as the worker's contract", () => {
    const contract = readFileSync(path.join(ROOT, "workers/editor/contract.py"), "utf8");
    const tuple = /^SKILL_FILES = \(([^)]*)\)/m.exec(contract)?.[1] ?? "";
    expect([...tuple.matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort()).toEqual([...EDITABLE_SKILL_PATHS].sort());
    expect(contract).toMatch(/^MAX_SKILL_BYTES = 200 \* 1024$/m);
  });
});

let db: TestDb;
let a: Seeded;
const admin = (): Access => ({ ...a.user, role: "admin" });

const post = (body: unknown) =>
  changeRoute(new NextRequest("http://localhost/api/admin/skill", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }));
const history = async (p: string) => {
  const res = await historyRoute(new NextRequest(`http://localhost/api/admin/skill/history?path=${encodeURIComponent(p)}`));
  return { status: res.status, json: (await res.json()) as { versions?: Array<{ id: string; content: string; note: string | null; createdBy: string; isDefault: boolean }> } };
};
const rows = () => db.select().from(schema.editorSkillVersions);

beforeEach(async () => {
  db = (await import("@/lib/db")).db as unknown as TestDb;
  const names = (await tableNames(db)).map((n) => `"${n}"`).join(", ");
  await db.execute(sql.raw(`truncate table ${names} cascade`));
  a = await seedWorkspace(db, "Alpha", "00000000-0000-4000-8000-00000000000a");
  state.current = admin();
});

describe("admin skill API: who may use it", () => {
  it("refuses a non-admin (403) and anyone signed out (401), changing nothing", async () => {
    for (const who of [a.user, null]) {
      state.current = who;
      const want = who ? 403 : 401;
      expect((await filesRoute()).status).toBe(want);
      expect((await post({ action: "save", path: "hooks.md", content: "x" })).status).toBe(want);
      expect((await post({ action: "reset", path: "hooks.md" })).status).toBe(want);
      expect((await history("hooks.md")).status).toBe(want);
    }
    expect(await rows()).toHaveLength(0);
  });

  it("refuses a disabled admin", async () => {
    state.current = { ...admin(), status: "disabled" };
    expect((await filesRoute()).status).toBe(403);
  });
});

describe("admin skill API: paths and sizes", () => {
  it("accepts only the known markdown paths", async () => {
    for (const p of ["../app.py", "/etc/passwd", "scripts/render.sh", "profiles/../SKILL.md", "SKILL.MD", "", "new.md"]) {
      const res = await post({ action: "save", path: p, content: "x" });
      expect(res.status, p).toBe(400);
      expect((await post({ action: "reset", path: p })).status, p).toBe(400);
      expect((await history(p)).status, p).toBe(400);
    }
    expect((await post({ action: "nope", path: "hooks.md" })).status).toBe(400);
    expect(await rows()).toHaveLength(0);
  });

  it("caps a save at 100 KB", async () => {
    const res = await post({ action: "save", path: "hooks.md", content: "x".repeat(MAX_SKILL_FILE_BYTES + 1) });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/100 KB/);
    expect((await post({ action: "save", path: "hooks.md", content: "x".repeat(MAX_SKILL_FILE_BYTES) })).status).toBe(200);
  });

  it("refuses a save that would take the whole set over the worker's 200 KB", async () => {
    expect((await post({ action: "save", path: "hooks.md", content: "x".repeat(MAX_SKILL_FILE_BYTES) })).status).toBe(200);
    const res = await post({ action: "save", path: "intake.md", content: "y".repeat(MAX_SKILL_FILE_BYTES) });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/200 KB/);
  });
});

describe("admin skill API: versions", () => {
  it("lists every file as Default until saved; a save makes it Changed and the newest version wins", async () => {
    let files = ((await (await filesRoute()).json()) as { files: Array<{ path: string; changed: boolean; content: string }> }).files;
    expect(files.map((f) => f.path)).toEqual([...EDITABLE_SKILL_PATHS]);
    expect(files.every((f) => !f.changed && f.content === SKILL_DEFAULTS[f.path])).toBe(true);

    expect((await post({ action: "save", path: "hooks.md", content: "# first", note: "  try one  " })).status).toBe(200);
    const res = await post({ action: "save", path: "hooks.md", content: "# second" });
    files = ((await res.json()) as { files: Array<{ path: string; changed: boolean; content: string; updatedBy: string }> }).files as typeof files;
    const hooks = files.find((f) => f.path === "hooks.md")!;
    expect(hooks).toMatchObject({ changed: true, content: "# second", updatedBy: "you" });
    expect((await currentSkillFiles())["hooks.md"]).toBe("# second");

    const h = await history("hooks.md");
    expect(h.json.versions!.map((v) => [v.content, v.note])).toEqual([["# second", null], ["# first", "try one"]]);
    expect(await rows()).toHaveLength(2);
  });

  it("restore adds a new row holding the old content", async () => {
    await post({ action: "save", path: "captions.md", content: "# v1" });
    await post({ action: "save", path: "captions.md", content: "# v2" });
    const v1 = (await history("captions.md")).json.versions![1];
    expect((await post({ action: "restore", path: "captions.md", versionId: v1.id })).status).toBe(200);
    const after = (await history("captions.md")).json.versions!;
    expect(after.map((v) => v.content)).toEqual(["# v1", "# v2", "# v1"]);
    expect(after[0].note).toMatch(/^Restored the version from /);
    expect((await currentSkillFiles())["captions.md"]).toBe("# v1");
    // A version id of another file is not accepted.
    expect((await post({ action: "restore", path: "hooks.md", versionId: v1.id })).status).toBe(400);
    expect((await post({ action: "restore", path: "hooks.md", versionId: "not-a-uuid" })).status).toBe(400);
  });

  it("reset adds a new row holding the repo copy, so the file reads as Default again", async () => {
    await post({ action: "save", path: "profiles/build.md", content: "# mine" });
    const res = await post({ action: "reset", path: "profiles/build.md" });
    const files = ((await res.json()) as { files: Array<{ path: string; changed: boolean }> }).files;
    expect(files.find((f) => f.path === "profiles/build.md")!.changed).toBe(false);
    const versions = (await history("profiles/build.md")).json.versions!;
    expect(versions).toHaveLength(2);
    expect(versions[0]).toMatchObject({ content: SKILL_DEFAULTS["profiles/build.md"], note: "Reset to default", isDefault: true });
  });

  it("names other admins by email and the caller as you", async () => {
    await db.insert(schema.editorSkillVersions).values({ path: "intake.md", content: "# theirs", createdBy: "00000000-0000-4000-8000-00000000000c" });
    await post({ action: "save", path: "intake.md", content: "# mine" });
    expect((await history("intake.md")).json.versions!.map((v) => v.createdBy)).toEqual(["you", "c@example.test"]);
  });
});
