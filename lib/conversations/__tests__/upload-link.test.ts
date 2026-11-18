import { eq, sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { seedWorkspace, snapshot, tableNames, type Seeded, type TestDb } from "@/app/api/__tests__/separation/world";
import * as schema from "@/lib/db/schema";

vi.hoisted(() => {
  process.env.DATABASE_URL ??= "postgres://test:test@localhost/test";
  process.env.TOKEN_ENCRYPTION_KEY ??= "0000000000000000000000000000000000000000000000000000000000000000";
});

vi.mock("@/lib/db", async () => {
  const actual = await vi.importActual<typeof import("@/lib/db")>("@/lib/db");
  const { makeTestDb } = await import("@/app/api/__tests__/separation/world");
  return { ...actual, db: await makeTestDb() };
});
vi.mock("@/lib/auth/session", () => ({ getAccess: async () => null }));

import { POST as start } from "@/app/api/u/[token]/uploads/route";
import { createUploadToken, requireUploadLink, UPLOAD_LINK_TTL_MS, verifyUploadToken } from "../upload-link";

const ID = "f5a1b2c3-41fa-4c62-8178-78979c14a95b";
const NOW = Date.parse("2026-11-17T12:00:00Z");

describe("upload tokens", () => {
  it("round-trip the thread id, are 43 characters, and expire after the TTL", () => {
    const token = createUploadToken(ID, NOW);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(verifyUploadToken(token, NOW)).toMatchObject({ ok: true, conversationId: ID });
    expect(verifyUploadToken(token, NOW + UPLOAD_LINK_TTL_MS + 1000)).toEqual({ ok: false, reason: "expired" });
  });

  it("refuse any change, another key, and junk", () => {
    const token = createUploadToken(ID, NOW);
    const flipped = token.slice(0, 5) + (token[5] === "A" ? "B" : "A") + token.slice(6);
    expect(verifyUploadToken(flipped, NOW)).toEqual({ ok: false, reason: "invalid" });
    expect(verifyUploadToken(token, NOW, { TOKEN_ENCRYPTION_KEY: "other" })).toEqual({ ok: false, reason: "invalid" });
    expect(verifyUploadToken("short", NOW)).toEqual({ ok: false, reason: "invalid" });
    expect(verifyUploadToken(null, NOW)).toEqual({ ok: false, reason: "invalid" });
  });
});

describe("opening a thread from a link", () => {
  let db: TestDb;
  let a: Seeded;

  beforeEach(async () => {
    db = (await import("@/lib/db")).db as unknown as TestDb;
    const names = (await tableNames(db)).map((t) => `"${t}"`).join(", ");
    await db.execute(sql.raw(`truncate table ${names} cascade`));
    a = await seedWorkspace(db, "Alpha", "00000000-0000-4000-8000-00000000000a");
  });

  it("opens only the thread it names, as its starter, with the brand name", async () => {
    const access = await requireUploadLink(createUploadToken(a.conversationId));
    expect(access.conversation.id).toBe(a.conversationId);
    expect(access.user.userId).toBe(a.user.userId);
    expect(access.brandName).toBe("Alpha brand");
  });

  it("stops working once the starter leaves the workspace", async () => {
    const token = createUploadToken(a.conversationId);
    await db.delete(schema.workspaceMembers).where(eq(schema.workspaceMembers.userId, a.user.userId));
    await expect(requireUploadLink(token)).rejects.toMatchObject({ status: 404 });
  });

  it("the upload routes refuse a bad link with 403 before any work, and let a good one through", async () => {
    const body = JSON.stringify({ filename: "clip.mov", size: 1000, contentType: "video/quicktime" });
    const call = (token: string) =>
      start(new NextRequest(`https://app.test/api/u/${token}/uploads`, { method: "POST", body, headers: { "content-type": "application/json" } }), {
        params: Promise.resolve({ token }),
      });
    const before = await snapshot(db);
    expect((await call("x".repeat(43))).status).toBe(403);
    expect(await snapshot(db)).toEqual(before);
    // A good link reaches the upload step (storage is not configured in tests).
    expect([200, 503]).toContain((await call(createUploadToken(a.conversationId))).status);
  });
});
