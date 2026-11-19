/**
 * Settings > Editor style: defaults reproduce today's skill, a brand's edits reach the job, brands
 * stay apart, Advanced stays admin-only, and suggested tweaks can be accepted or dismissed.
 * In-memory database; the worker endpoint and Claude are mocked.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { and, eq, sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { seedEditorJob, seedWorkspace, tableNames, type Seeded, type TestDb } from "@/app/api/__tests__/separation/world";
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
vi.mock("@/lib/storage/r2", async () => {
  const actual = await vi.importActual<typeof import("@/lib/storage/r2")>("@/lib/storage/r2");
  return { ...actual, presignGet: (key: string) => `https://r2.test/get/${key}`, presignPut: (key: string) => `https://r2.test/put/${key}` };
});
vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: () => ({ auth: { admin: { getUserById: async (id: string) => ({ data: { user: { id, email: `${id.slice(-1)}@example.test` } } }) } } }),
}));

import { GET as styleGet, POST as stylePost } from "@/app/api/brands/[id]/editor-style/route";
import { GET as historyGet } from "@/app/api/brands/[id]/editor-style/history/route";
import { POST as suggestionPost } from "@/app/api/brands/[id]/editor-style/suggestions/route";
import { POST as adminSkillPost } from "@/app/api/admin/skill/route";
import { handOffToEditor } from "@/lib/conversations/editor";
import { SKILL_DEFAULTS } from "@/lib/editor/skill-defaults.generated";
import { EDITABLE_SKILL_PATHS } from "@/lib/editor/skill-files";
import { hasManifestSection } from "@/lib/editor/skill-store";
import { compileStyle, STYLE_FILE, STYLE_POINTER } from "@/lib/editor/style-compile";
import { defaultStyle } from "@/lib/editor/style-defaults";
import { askForTweak, notesWithTweak, proposeStyleTweak } from "@/lib/editor/style-learning";
import { MAX_STYLE_BYTES, parseSectionValue, SECTIONS, STYLE_SECTION_IDS, type FootageType } from "@/lib/editor/style-schema";
import { currentStyle } from "@/lib/editor/style-store";

const ROOT = path.resolve(__dirname, "../../..");
let db: TestDb;
let a: Seeded;
let b: Seeded;
let fetchMock: ReturnType<typeof vi.fn>;

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const json = (body: unknown) => ({ method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
const save = (brandId: string, body: unknown) => stylePost(new NextRequest(`http://localhost/api/brands/${brandId}/editor-style`, json(body)), ctx(brandId));
const get = (brandId: string) => styleGet(new NextRequest(`http://localhost/api/brands/${brandId}/editor-style`), ctx(brandId));
const decide = (brandId: string, suggestionId: string, decision: "accept" | "dismiss") =>
  suggestionPost(new NextRequest(`http://localhost/api/brands/${brandId}/editor-style/suggestions`, json({ suggestionId, decision })), ctx(brandId));
const say = async (body: string, who = a) => {
  const [m] = await db.insert(schema.conversationMessages).values({ conversationId: who.conversationId, direction: "in", channel: "app", body, authorUserId: who.user.userId }).returning();
  return handOffToEditor(who.conversationId, m.id, "http://localhost");
};
const sentJob = () => JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
const claudeSays = (out: unknown) =>
  vi.fn(async () => new Response(JSON.stringify({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(out) }] }), { status: 200 }));

beforeEach(async () => {
  db = (await import("@/lib/db")).db as unknown as TestDb;
  const names = (await tableNames(db)).map((n) => `"${n}"`).join(", ");
  await db.execute(sql.raw(`truncate table ${names} cascade`));
  a = await seedWorkspace(db, "Alpha", "00000000-0000-4000-8000-00000000000a");
  b = await seedWorkspace(db, "Bravo", "00000000-0000-4000-8000-00000000000b");
  // Start without the seeded suggestions; tests add their own.
  await db.delete(schema.editorStyleSuggestions);
  state.current = a.user;
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ accepted: true }), { status: 202 }));
  vi.stubGlobal("fetch", fetchMock);
  process.env.MODAL_EDITOR_URL = "https://editor.test";
  process.env.MODAL_EDITOR_SECRET = "secret";
  process.env.APP_URL = "https://app.test";
});

afterEach(() => {
  for (const k of ["MODAL_EDITOR_URL", "MODAL_EDITOR_SECRET", "APP_URL"]) delete process.env[k];
});

describe("defaults", () => {
  it("prefill every text box in plain words, with no markdown symbols", () => {
    const style = defaultStyle();
    const plain = (text: string, label: string) => expect(text, label).not.toMatch(/\*\*|`|^#|^\s*[-*] |^\s*\d+\. |\|/m);
    for (const id of STYLE_SECTION_IDS) {
      plain(style[id].notes, id);
      if (id !== "never") expect(style[id].notes.trim(), id).not.toBe("");
    }
    for (const t of style.footage.picks.types as FootageType[]) {
      for (const text of [t.when, t.pacing, t.notes]) plain(text, t.name);
      expect(t.ranked.length).toBeGreaterThan(3);
      for (const r of t.ranked) expect(SKILL_DEFAULTS[`profiles/${t.id}.md`]).toContain(`**${r}**`);
    }
    expect(style.shots.picks.skip).toContain("nothing happening");
    expect((style.never.picks.rules as string[]).length).toBeGreaterThan(3);
  });

  it("are valid, and a brand that changed nothing gets no style.md", () => {
    const style = defaultStyle();
    for (const id of STYLE_SECTION_IDS) expect(parseSectionValue(id, style[id], style[id])).toEqual({ ok: true, value: style[id] });
    expect(compileStyle(style, "Alpha")).toBeNull();
  });

  it("send exactly today's skill files for a brand with no style", async () => {
    await say("make a reel");
    const sent = sentJob();
    expect(Object.keys(sent.skillFiles).sort()).toEqual([...EDITABLE_SKILL_PATHS].sort());
    for (const p of EDITABLE_SKILL_PATHS) expect(sent.skillFiles[p]).toBe(SKILL_DEFAULTS[p]);
  });

  it("a style saved back to the default changes nothing", async () => {
    expect((await save(a.brandId, { action: "save", section: "opener", value: { picks: { maxWords: 5 } } })).status).toBe(200);
    expect((await save(a.brandId, { action: "reset", section: "opener" })).status).toBe(200);
    expect(compileStyle(await currentStyle(a.brandId), "Alpha")).toBeNull();
  });
});

describe("a brand's edits reach the job", () => {
  it("as style.md, with a pointer in SKILL.md; the other brand's job is untouched", async () => {
    const res = await save(a.brandId, { action: "save", section: "opener", value: { picks: { maxWords: 6, examples: ["Built in one night"] }, notes: "Open on the finished stand." }, note: "shorter" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sections: Array<{ id: string; changed: boolean }> };
    expect(body.sections.find((s) => s.id === "opener")?.changed).toBe(true);

    await say("make a reel");
    const sent = sentJob();
    expect(sent.skillFiles[STYLE_FILE]).toContain("## 2. Opener");
    expect(sent.skillFiles[STYLE_FILE]).toContain("Most words on screen: 6 words");
    expect(sent.skillFiles[STYLE_FILE]).toContain("- Built in one night");
    expect(sent.skillFiles[STYLE_FILE]).toContain("Open on the finished stand.");
    expect(sent.skillFiles[STYLE_FILE]).not.toContain("## 1. Brand"); // unchanged sections stay out
    expect(sent.skillFiles["SKILL.md"]).toBe(`${SKILL_DEFAULTS["SKILL.md"].replace(/\s+$/, "")}${STYLE_POINTER}`);
    expect(sent.skillFiles["hooks.md"]).toBe(SKILL_DEFAULTS["hooks.md"]);

    fetchMock.mockClear();
    await say("make a reel", b);
    expect(sentJob().skillFiles[STYLE_FILE]).toBeUndefined();
  });

  it("includes footage types a brand adds", async () => {
    const types = [...(defaultStyle().footage.picks.types as FootageType[]), { id: "custom-tasting", name: "Tasting day", builtIn: false, when: "Guests trying flavours", ranked: ["First sip"], pacing: "Real speed", notes: "" }];
    expect((await save(a.brandId, { action: "save", section: "footage", value: { picks: { types } } })).status).toBe(200);
    await say("make a reel");
    expect(sentJob().skillFiles[STYLE_FILE]).toContain("### Tasting day (added by the brand)");
  });

  it("refuses bad values and a style too big for a job", async () => {
    for (const body of [
      { action: "save", section: "nope", value: {} },
      { action: "save", section: "opener", value: { picks: { maxWords: 99 } } },
      { action: "save", section: "opener", value: { picks: { firstShot: "explosion" } } },
      { action: "save", section: "opener", value: { picks: { surprise: true } } },
      { action: "save", section: "footage", value: { picks: { types: [] } } },
      { action: "restore", section: "opener", versionId: "not-a-uuid" },
    ]) {
      expect((await save(a.brandId, body)).status, JSON.stringify(body)).toBe(400);
    }
    for (const id of STYLE_SECTION_IDS.filter((s) => s !== "footage")) {
      expect((await save(a.brandId, { action: "save", section: id, value: { notes: "x".repeat(5999) } })).status, id).toBe(200);
    }
    const big = Array.from({ length: 6 }, (_, i) => ({ id: `custom-${i}`, name: `Type ${i}`, builtIn: false, when: "w", ranked: ["r"], pacing: "p".repeat(2000), notes: "n".repeat(3000) }));
    const res = await save(a.brandId, { action: "save", section: "footage", value: { picks: { types: big } } });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/too long/);
  });

  it("keeps every version; restore brings an old one back as the newest", async () => {
    await save(a.brandId, { action: "save", section: "captions", value: { picks: { emojis: 0 } } });
    await save(a.brandId, { action: "save", section: "captions", value: { picks: { emojis: 5 } } });
    const hist = async () =>
      ((await (await historyGet(new NextRequest(`http://localhost/api/brands/${a.brandId}/editor-style/history?section=captions`), ctx(a.brandId))).json()) as {
        versions: Array<{ id: string; value: { picks: { emojis: number } } }>;
      }).versions;
    const [newest, older] = await hist();
    expect([newest.value.picks.emojis, older.value.picks.emojis]).toEqual([5, 0]);
    expect((await save(a.brandId, { action: "restore", section: "captions", versionId: older.id })).status).toBe(200);
    expect((await currentStyle(a.brandId)).captions.picks.emojis).toBe(0);
    expect(await hist()).toHaveLength(3);
  });
});

describe("brand separation", () => {
  it("another workspace can't read, edit, restore or decide", async () => {
    await save(a.brandId, { action: "save", section: "never", value: { picks: { rules: ["Alpha secret rule"] } } });
    const [version] = await db.select().from(schema.editorStyleVersions).where(eq(schema.editorStyleVersions.brandId, a.brandId));
    const [sug] = await db.insert(schema.editorStyleSuggestions).values({ workspaceId: a.workspaceId, brandId: a.brandId, section: "opener", change: "Alpha tweak", source: "approved" }).returning();

    state.current = b.user;
    expect((await get(a.brandId)).status).toBe(404);
    expect((await save(a.brandId, { action: "save", section: "never", value: { picks: { rules: ["taken"] } } })).status).toBe(404);
    expect((await historyGet(new NextRequest(`http://localhost/api/brands/${a.brandId}/editor-style/history?section=never`), ctx(a.brandId))).status).toBe(404);
    // Their own brand, but Alpha's version or suggestion: refused, nothing changes.
    expect((await save(b.brandId, { action: "restore", section: "never", versionId: version.id })).status).toBe(400);
    expect((await decide(b.brandId, sug.id, "accept")).status).toBe(404);
    const bView = await (await get(b.brandId)).text();
    expect(bView).not.toContain("Alpha");

    state.current = null;
    expect((await get(a.brandId)).status).toBe(401);
    expect((await currentStyle(a.brandId)).never.picks.rules).toEqual(["Alpha secret rule"]);
    expect((await db.select().from(schema.editorStyleSuggestions).where(eq(schema.editorStyleSuggestions.id, sug.id)))[0].status).toBe("pending");
  });
});

describe("Advanced (the technical steps)", () => {
  it("is admin-only: brand users can't save skill files, and the page says they can't edit", async () => {
    const res = await adminSkillPost(new NextRequest("http://localhost/api/admin/skill", json({ action: "save", path: "SKILL.md", content: SKILL_DEFAULTS["SKILL.md"] })));
    expect(res.status).toBe(403);
    expect(((await (await get(a.brandId)).json()) as { canEditAdvanced: boolean }).canEditAdvanced).toBe(false);
    state.current = { ...a.user, role: "admin" } satisfies Access;
    expect(((await (await get(a.brandId)).json()) as { canEditAdvanced: boolean }).canEditAdvanced).toBe(true);
  });

  it("refuses a SKILL.md without its manifest section", async () => {
    state.current = { ...a.user, role: "admin" } satisfies Access;
    expect(hasManifestSection(SKILL_DEFAULTS["SKILL.md"])).toBe(true);
    const broken = SKILL_DEFAULTS["SKILL.md"].replace("## out/manifest.json", "## Results");
    const res = await adminSkillPost(new NextRequest("http://localhost/api/admin/skill", json({ action: "save", path: "SKILL.md", content: broken })));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/manifest/);
    expect((await adminSkillPost(new NextRequest("http://localhost/api/admin/skill", json({ action: "save", path: "SKILL.md", content: `${SKILL_DEFAULTS["SKILL.md"]}\n` })))).status).toBe(200);
  });
});

describe("suggested tweaks", () => {
  it("one per job: stored with a chat note; accept adds it to the section as a new version", async () => {
    const { editorJobId } = await seedEditorJob(db, a, "Alpha");
    const fake = claudeSays({ suggest: true, section: "opener", change: "Keep on-screen text under 6 words", reason: "Asked twice for shorter hooks" });
    const row = await proposeStyleTweak({ jobId: editorJobId, source: "approved" }, { fetchImpl: fake, key: "k" });
    expect(row).toMatchObject({ brandId: a.brandId, section: "opener", status: "pending" });
    const call = JSON.parse((fake.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(call.model).toBe("claude-opus-5-5");
    expect(call.output_config.format.type).toBe("json_schema");
    const notes = await db.select().from(schema.conversationMessages).where(eq(schema.conversationMessages.conversationId, a.conversationId));
    expect(notes.some((m) => m.body.startsWith("Suggested a style tweak for Opener"))).toBe(true);

    // The same job again: no second call.
    const again = claudeSays({ suggest: true, section: "captions", change: "x", reason: "y" });
    expect(await proposeStyleTweak({ jobId: editorJobId, source: "approved" }, { fetchImpl: again, key: "k" })).toBeNull();
    expect(again).not.toHaveBeenCalled();

    const view = (await (await get(a.brandId)).json()) as { suggestions: Array<{ id: string; sectionTitle: string }> };
    expect(view.suggestions).toHaveLength(1);
    expect(view.suggestions[0].sectionTitle).toBe("Opener");
    expect((await decide(a.brandId, row!.id, "accept")).status).toBe(200);
    expect((await currentStyle(a.brandId)).opener.notes.endsWith("- Keep on-screen text under 6 words")).toBe(true);
    const [version] = await db.select().from(schema.editorStyleVersions).where(and(eq(schema.editorStyleVersions.brandId, a.brandId), eq(schema.editorStyleVersions.section, "opener")));
    expect(version.note).toMatch(/Asked twice/);
    expect((await decide(a.brandId, row!.id, "accept")).status).toBe(404); // already decided
  });

  it("dismiss changes nothing in the style", async () => {
    const [sug] = await db.insert(schema.editorStyleSuggestions).values({ workspaceId: a.workspaceId, brandId: a.brandId, section: "captions", change: "No emojis", source: "changes" }).returning();
    expect((await decide(a.brandId, sug.id, "dismiss")).status).toBe(200);
    expect(await db.select().from(schema.editorStyleVersions)).toHaveLength(0);
    expect((await db.select().from(schema.editorStyleSuggestions))[0].status).toBe("dismissed");
  });

  it("never piles up: one pending per section, three per brand; 'nothing' stores nothing", async () => {
    const { editorJobId } = await seedEditorJob(db, a, "Alpha");
    expect(await proposeStyleTweak({ jobId: editorJobId, source: "approved" }, { fetchImpl: claudeSays({ suggest: false, section: "opener", change: "", reason: "" }), key: "k" })).toBeNull();
    await db.insert(schema.editorStyleSuggestions).values({ workspaceId: a.workspaceId, brandId: a.brandId, section: "opener", change: "one", source: "approved" });
    // Same section as a pending one: dropped.
    expect(await proposeStyleTweak({ jobId: editorJobId, source: "changes", request: "shorter" }, { fetchImpl: claudeSays({ suggest: true, section: "opener", change: "two", reason: "" }), key: "k" })).toBeNull();
    await db.insert(schema.editorStyleSuggestions).values([
      { workspaceId: a.workspaceId, brandId: a.brandId, section: "captions", change: "c", source: "approved" },
      { workspaceId: a.workspaceId, brandId: a.brandId, section: "sound", change: "s", source: "approved" },
    ]);
    const full = claudeSays({ suggest: true, section: "never", change: "n", reason: "" });
    const [job2] = await db.insert(schema.editorJobs).values({ workspaceId: a.workspaceId, conversationId: a.conversationId, brandId: a.brandId, kind: "first_cut", status: "done", model: "claude-opus-5-5" }).returning();
    expect(await proposeStyleTweak({ jobId: job2.id, source: "approved" }, { fetchImpl: full, key: "k" })).toBeNull();
    expect(full).not.toHaveBeenCalled();
    // The database refuses a second pending one for a section too.
    await expect(db.insert(schema.editorStyleSuggestions).values({ workspaceId: a.workspaceId, brandId: a.brandId, section: "opener", change: "dup", source: "approved" })).rejects.toThrow();
  });

  it("survives Claude failing, and adds a tweak as its own line", async () => {
    expect(await askForTweak({ key: "k", brandName: "A", source: "approved", style: defaultStyle(), messages: [], cuts: "", request: null, skip: [] }, vi.fn(async () => new Response("no", { status: 500 })))).toBeNull();
    expect(await askForTweak({ key: "k", brandName: "A", source: "approved", style: defaultStyle(), messages: [], cuts: "", request: null, skip: [] }, vi.fn(async () => { throw new Error("down"); }))).toBeNull();
    expect(notesWithTweak("", "Short hooks")).toBe("- Short hooks");
    expect(notesWithTweak("Line one\n", "Short hooks")).toBe("Line one\n- Short hooks");
  });

  it("approving in the app does not wait for, or fail on, the suggestion call", async () => {
    await seedEditorJob(db, a, "Alpha");
    fetchMock.mockImplementation(async () => {
      throw new Error("network down");
    });
    const { approvePendingPreview } = await import("@/lib/conversations/editor");
    expect(await approvePendingPreview(a.conversationId)).toEqual({ approved: true });
  });
});

describe("worker contract", () => {
  it("accepts style.md with its own size cap, kept in step with the app", () => {
    const contract = readFileSync(path.join(ROOT, "workers/editor/contract.py"), "utf8");
    expect(contract).toMatch(new RegExp(`^STYLE_FILE = "${STYLE_FILE}"$`, "m"));
    expect(contract).toMatch(new RegExp(`^MAX_STYLE_BYTES = ${MAX_STYLE_BYTES / 1024} \\* 1024$`, "m"));
    expect(SECTIONS.map((s) => s.id)).toEqual([...STYLE_SECTION_IDS]);
  });
});
