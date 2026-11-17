import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { seedWorkspace, tableNames, type Seeded, type TestDb } from "@/app/api/__tests__/separation/world";
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

import { confirmCode, findVerifiedUserByPhone, MAX_CODE_ATTEMPTS, phoneStatus, removePhone, startVerification, WELCOME_TEXT } from "../phones";

let db: TestDb;
let a: Seeded;
let b: Seeded;
const NEW = "+16195550123";
const T0 = new Date("2026-11-14T12:00:00Z");
const later = (ms: number) => new Date(T0.getTime() + ms);

function deps(now = T0, code = "123456") {
  const sent: Array<{ to: string; body: string }> = [];
  return { sent, deps: { send: async (to: string, body: string) => void sent.push({ to, body }), now: () => now, generateCode: () => code } };
}

beforeEach(async () => {
  db = (await import("@/lib/db")).db as unknown as TestDb;
  const names = (await tableNames(db)).map((n) => `"${n}"`).join(", ");
  await db.execute(sql.raw(`truncate table ${names} cascade`));
  a = await seedWorkspace(db, "Alpha", "00000000-0000-4000-8000-00000000000a");
  b = await seedWorkspace(db, "Beta", "00000000-0000-4000-8000-00000000000b");
  await removePhone(a.user.userId);
});

describe("adding a number", () => {
  it("texts a code, stores only its hash, and confirms it", async () => {
    const { sent, deps: d } = deps();
    expect(await startVerification(a.user.userId, "(619) 555-0123", d)).toEqual({ ok: true });
    expect(sent).toEqual([{ to: NEW, body: "Your Nekter code is 123456. It expires in 10 minutes." }]);
    const [row] = await db.select().from(schema.memberPhones).where(eq(schema.memberPhones.userId, a.user.userId));
    expect(row.codeHash).not.toContain("123456");
    expect(await findVerifiedUserByPhone(NEW)).toBeNull();
    expect(await confirmCode(a.user.userId, "123 456", later(60_000), d)).toEqual({ ok: true });
    expect(await findVerifiedUserByPhone(NEW)).toBe(a.user.userId);
    expect(await phoneStatus(a.user.userId)).toMatchObject({ phone: NEW, verified: true, codePending: false });
    expect(sent[1]).toEqual({ to: NEW, body: WELCOME_TEXT });
  });

  it("stays confirmed when the welcome text fails to send", async () => {
    await startVerification(a.user.userId, NEW, deps().deps);
    const failing = async () => Promise.reject(new Error("salesmsg down"));
    expect(await confirmCode(a.user.userId, "123456", later(1000), { send: failing })).toEqual({ ok: true });
    expect(await findVerifiedUserByPhone(NEW)).toBe(a.user.userId);
  });

  it("sends no welcome for a wrong code", async () => {
    const { sent, deps: d } = deps();
    await startVerification(a.user.userId, NEW, d);
    await confirmCode(a.user.userId, "000000", later(1000), d);
    expect(sent).toHaveLength(1);
  });

  it("rejects a wrong code and counts the try", async () => {
    await startVerification(a.user.userId, NEW, deps().deps);
    expect(await confirmCode(a.user.userId, "000000", later(1000))).toEqual({ ok: false, error: "That code isn't right." });
    const [row] = await db.select().from(schema.memberPhones).where(eq(schema.memberPhones.userId, a.user.userId));
    expect(row.codeAttempts).toBe(1);
    expect(row.verifiedAt).toBeNull();
  });

  it("expires a code after 10 minutes", async () => {
    await startVerification(a.user.userId, NEW, deps().deps);
    expect(await confirmCode(a.user.userId, "123456", later(10 * 60_000 + 1))).toEqual({ ok: false, error: "That code has expired. Ask for a new one." });
    expect(await findVerifiedUserByPhone(NEW)).toBeNull();
  });

  it("stops after five tries, even with the right code", async () => {
    await startVerification(a.user.userId, NEW, deps().deps);
    for (let i = 0; i < MAX_CODE_ATTEMPTS; i++) await confirmCode(a.user.userId, "999999", later(1000));
    expect(await confirmCode(a.user.userId, "123456", later(2000))).toEqual({ ok: false, error: "Too many tries. Ask for a new code." });
    expect(await findVerifiedUserByPhone(NEW)).toBeNull();
  });

  it("rate-limits sending codes", async () => {
    expect((await startVerification(a.user.userId, NEW, deps(T0).deps)).ok).toBe(true);
    expect(await startVerification(a.user.userId, NEW, deps(later(10_000)).deps)).toEqual({ ok: false, error: "Wait a moment before asking for another code." });
    for (let i = 1; i < 5; i++) expect((await startVerification(a.user.userId, NEW, deps(later(i * 60_000)).deps)).ok).toBe(true);
    expect(await startVerification(a.user.userId, NEW, deps(later(6 * 60_000)).deps)).toEqual({ ok: false, error: "Too many codes sent. Try again in an hour." });
    expect((await startVerification(a.user.userId, NEW, deps(later(61 * 60_000)).deps)).ok).toBe(true);
  });

  it("rejects something that is not a phone number", async () => {
    expect((await startVerification(a.user.userId, "12345", deps().deps)).ok).toBe(false);
  });

  it("does not store a code it could not send", async () => {
    const failing = { ...deps().deps, send: async () => Promise.reject(new Error("twilio down")) };
    expect((await startVerification(a.user.userId, NEW, failing)).ok).toBe(false);
    expect(await phoneStatus(a.user.userId, T0)).toMatchObject({ codePending: false });
  });
});

describe("one number, one person", () => {
  it("refuses a number already confirmed by another user, leaving theirs alone", async () => {
    const { sent, deps: d } = deps();
    expect(await startVerification(a.user.userId, b.phone, d)).toEqual({ ok: false, error: "That number is linked to another account." });
    expect(sent).toEqual([]);
    expect(await findVerifiedUserByPhone(b.phone)).toBe(b.user.userId);
  });

  it("refuses a number another user is confirming right now, but not a stale claim", async () => {
    await removePhone(b.user.userId);
    await startVerification(b.user.userId, NEW, deps(T0).deps);
    expect((await startVerification(a.user.userId, NEW, deps(later(60_000)).deps)).ok).toBe(false);
    expect((await startVerification(a.user.userId, NEW, deps(later(11 * 60_000)).deps)).ok).toBe(true);
    expect(await phoneStatus(b.user.userId)).toBeNull();
  });

  it("is unique in the database too", async () => {
    await expect(db.insert(schema.memberPhones).values({ userId: a.user.userId, phoneE164: b.phone })).rejects.toThrow();
  });
});
