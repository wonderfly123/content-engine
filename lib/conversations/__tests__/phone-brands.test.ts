import { and, eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { seedWorkspace, tableNames, type Seeded, type TestDb } from "@/app/api/__tests__/separation/world";
import * as schema from "@/lib/db/schema";

vi.hoisted(() => {
  process.env.DATABASE_URL ??= "postgres://test:test@localhost/test";
  process.env.TOKEN_ENCRYPTION_KEY ??= "0000000000000000000000000000000000000000000000000000000000000000";
  delete process.env.APP_URL;
});

vi.mock("@/lib/db", async () => {
  const actual = await vi.importActual<typeof import("@/lib/db")>("@/lib/db");
  const { makeTestDb } = await import("@/app/api/__tests__/separation/world");
  return { ...actual, db: await makeTestDb() };
});
vi.mock("@/lib/auth/session", () => ({ getAccess: async () => null }));

import { handleIncomingText, resetUnknownNumberMemory } from "../handle";
import { confirmCode, phoneBrandIds, phoneOnForBrand, removePhone, startVerification, turnOffForBrand, turnOnForBrand } from "../phones";
import { NO_BRAND_REPLY } from "../router";
import { textMember } from "@/lib/editor/notify";

let db: TestDb;
let a: Seeded;
let b: Seeded;
let n = 0;

const text = (from: string, body: string) => handleIncomingText({ from, body, messageSid: `SM-pb-${++n}`, origin: "https://app.test" });
const addBrand = async (name: string, workspaceId = a.workspaceId) =>
  (await db.insert(schema.brands).values({ workspaceId, name, slug: name.toLowerCase().replace(/\W+/g, "-"), status: "active" }).returning())[0].id;
const unlinkAll = () => db.delete(schema.memberPhoneBrands).where(eq(schema.memberPhoneBrands.userId, a.user.userId));
const threadOf = async (conversationId: string) =>
  (await db.select().from(schema.conversations).where(eq(schema.conversations.id, conversationId)))[0];

beforeEach(async () => {
  db = (await import("@/lib/db")).db as unknown as TestDb;
  const names = (await tableNames(db)).map((t) => `"${t}"`).join(", ");
  await db.execute(sql.raw(`truncate table ${names} cascade`));
  a = await seedWorkspace(db, "Alpha", "00000000-0000-4000-8000-00000000000a");
  b = await seedWorkspace(db, "Beta", "00000000-0000-4000-8000-00000000000b");
  await db.update(schema.conversations).set({ status: "closed" });
  resetUnknownNumberMemory();
});

describe("texting is per brand", () => {
  it("a confirmed number on for no brand is told to turn it on, and nothing is stored", async () => {
    await unlinkAll();
    const before = (await db.select().from(schema.conversationMessages)).length;
    expect(await text(a.phone, "new reel")).toBe(NO_BRAND_REPLY);
    expect((await db.select().from(schema.conversationMessages)).length).toBe(before);
  });

  it("goes straight to the only brand the number is on for, never asking about the others", async () => {
    await addBrand("Windansea Coconuts");
    const reply = await text(a.phone, "new reel");
    expect(reply).toContain("New reel for Alpha brand started");
    expect(reply).not.toContain("Which brand");
  });

  it("asks which brand only among the brands the number is on for", async () => {
    const wind = await addBrand("Windansea Coconuts");
    await addBrand("Secret Brand");
    await turnOnForBrand(a.user.userId, wind);
    const reply = await text(a.phone, "new story");
    expect(reply).toContain("Which brand: Alpha brand or Windansea Coconuts?");
    expect(reply).not.toContain("Secret Brand");
  });

  it("never reaches a brand named in the text that the number is off for", async () => {
    await addBrand("Secret Brand");
    const reply = await text(a.phone, "new reel for secret brand");
    expect(reply).toContain("Alpha brand");
    expect(reply).not.toContain("Secret Brand");
  });

  it("closes an open thread for a brand turned off, and starts the next text fresh", async () => {
    const wind = await addBrand("Windansea Coconuts");
    await turnOnForBrand(a.user.userId, wind);
    await turnOffForBrand(a.user.userId, a.brandId);
    await text(a.phone, "new reel");
    const [open] = await db.select().from(schema.conversations).where(and(eq(schema.conversations.startedBy, a.user.userId), eq(schema.conversations.status, "open")));
    expect(open.brandId).toBe(wind);

    await turnOnForBrand(a.user.userId, a.brandId);
    await turnOffForBrand(a.user.userId, wind);
    await text(a.phone, "make it shorter");
    expect((await threadOf(open.id)).closedReason).toBe("brand_texting_off");
  });

  it("goes to the workspace of the brand it is on for, not the oldest membership", async () => {
    await db.insert(schema.workspaceMembers).values({ workspaceId: b.workspaceId, userId: a.user.userId, role: "staff" });
    await unlinkAll();
    await turnOnForBrand(a.user.userId, b.brandId);
    expect(await text(a.phone, "new reel")).toContain("New reel for Beta brand started");
  });

  it("only turns on for a confirmed number, and removing the number turns it off everywhere", async () => {
    await db.update(schema.memberPhones).set({ verifiedAt: null }).where(eq(schema.memberPhones.userId, a.user.userId));
    await unlinkAll();
    expect(await turnOnForBrand(a.user.userId, a.brandId)).toEqual({ ok: false, error: "Confirm your number first." });
    expect(await phoneOnForBrand(a.user.userId, a.brandId)).toBe(false);
    await db.update(schema.memberPhones).set({ verifiedAt: new Date() }).where(eq(schema.memberPhones.userId, a.user.userId));
    await turnOnForBrand(a.user.userId, a.brandId);
    expect(await phoneBrandIds(a.user.userId)).toEqual([a.brandId]);
    await removePhone(a.user.userId);
    expect(await phoneBrandIds(a.user.userId)).toEqual([]);
  });

  it("confirming a code from a brand's Settings turns texting on for that brand only", async () => {
    await removePhone(a.user.userId);
    const wind = await addBrand("Windansea Coconuts");
    const send = async () => undefined;
    await startVerification(a.user.userId, "(619) 555-0199", { send, generateCode: () => "123456" });
    expect(await confirmCode(a.user.userId, "123456", new Date(), { send }, wind)).toEqual({ ok: true });
    expect(await phoneBrandIds(a.user.userId)).toEqual([wind]);
  });
});

describe("the editor's texts", () => {
  it("only text a thread's brand when the number is on for it", async () => {
    process.env.SALESMSG_API_TOKEN = "t";
    process.env.SALESMSG_TEAM_ID = "1";
    const sent: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      sent.push(new URL(url).searchParams.get("message") ?? "");
      return Response.json({ id: 1 });
    });
    try {
      await textMember(a.user.userId, "to alpha", a.brandId);
      await turnOffForBrand(a.user.userId, a.brandId);
      await textMember(a.user.userId, "not to alpha", a.brandId);
      expect(sent).toEqual(["to alpha"]);
    } finally {
      vi.unstubAllGlobals();
      delete process.env.SALESMSG_API_TOKEN;
      delete process.env.SALESMSG_TEAM_ID;
    }
  });
});
