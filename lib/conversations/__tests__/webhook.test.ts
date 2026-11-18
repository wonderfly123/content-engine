import { sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { seedWorkspace, snapshot, tableNames, type Seeded, type TestDb } from "@/app/api/__tests__/separation/world";

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

import { POST } from "@/app/api/salesmsg/sms/route";
import { resetUnknownNumberMemory } from "../handle";

const SECRET = "test-webhook-secret";
const TEAM = "4242";
const URL_OK = `https://app.test/api/salesmsg/sms?token=${SECRET}`;

let db: TestDb;
let a: Seeded;
let sent: { to: string; message: string; team: string }[];

function request(payload: unknown, url = URL_OK): NextRequest {
  return new NextRequest(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
}

const text = (from: string, body: string, id: string, inbox: number | string = TEAM) => ({
  message: { id, status: "received", body, received_at: "2026-11-17 10:00:00", sent_at: null, type: "sms" },
  contact: { number: from },
  inbox: { id: Number(inbox) },
});

const counts = async () =>
  (await db.execute(sql`select (select count(*) from conversations)::int as threads, (select count(*) from conversation_messages)::int as messages`)).rows[0] as {
    threads: number;
    messages: number;
  };

beforeEach(async () => {
  db = (await import("@/lib/db")).db as unknown as TestDb;
  const names = (await tableNames(db)).map((n) => `"${n}"`).join(", ");
  await db.execute(sql.raw(`truncate table ${names} cascade`));
  a = await seedWorkspace(db, "Alpha", "00000000-0000-4000-8000-00000000000a");
  process.env.SALESMSG_WEBHOOK_SECRET = SECRET;
  process.env.SALESMSG_API_TOKEN = "test-api-token";
  process.env.SALESMSG_TEAM_ID = TEAM;
  process.env.SALESMSG_PHONE_NUMBER = "(801) 457-0307";
  process.env.APP_URL = "https://app.test";
  resetUnknownNumberMemory();
  sent = [];
  vi.stubGlobal("fetch", async (input: string | URL) => {
    const u = new URL(String(input));
    sent.push({ to: u.searchParams.get("number") ?? "", message: u.searchParams.get("message") ?? "", team: u.searchParams.get("team_id") ?? "" });
    return Response.json({ id: 99 });
  });
});

afterEach(() => {
  for (const k of ["SALESMSG_WEBHOOK_SECRET", "SALESMSG_API_TOKEN", "SALESMSG_TEAM_ID", "SALESMSG_PHONE_NUMBER", "APP_URL"]) delete process.env[k];
  vi.unstubAllGlobals();
});

describe("POST /api/salesmsg/sms", () => {
  it("refuses a missing or wrong token with 403, writing and sending nothing", async () => {
    const before = await snapshot(db);
    expect((await POST(request(text(a.phone, "new reel", "1"), "https://app.test/api/salesmsg/sms"))).status).toBe(403);
    expect((await POST(request(text(a.phone, "new reel", "2"), "https://app.test/api/salesmsg/sms?token=nope"))).status).toBe(403);
    expect(await snapshot(db)).toEqual(before);
    expect(sent).toEqual([]);
  });

  it("refuses everything when the secret is not set", async () => {
    const before = await snapshot(db);
    delete process.env.SALESMSG_WEBHOOK_SECRET;
    expect((await POST(request(text(a.phone, "new reel", "3")))).status).toBe(403);
    expect(await snapshot(db)).toEqual(before);
  });

  it("answers a confirmed member through Salesmsg from the Content Engine inbox, with a link to the thread", async () => {
    const res = await POST(request(text(a.phone, "New reel!", "6")));
    expect(res.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(a.phone);
    expect(sent[0].team).toBe(TEAM);
    expect(sent[0].message).toMatch(/^New reel for Alpha brand started\. Tap to add your clips: https:\/\/app\.test\/u\/[A-Za-z0-9_-]{43}$/);
  });

  it("accepts a text identified by our number instead of the inbox id", async () => {
    const payload = { ...text(a.phone, "New reel!", "6b"), inbox: undefined, number: "+18014570307" };
    expect((await POST(request(payload))).status).toBe(200);
    expect(sent).toHaveLength(1);
  });

  it("ignores texts to the account's other inboxes, writing and sending nothing", async () => {
    const before = await snapshot(db);
    expect((await POST(request(text(a.phone, "new reel", "7", 223202)))).status).toBe(200);
    expect((await POST(request({ ...text("+16195550000", "hi", "7b"), inbox: undefined, number: "+18056000211" }))).status).toBe(200);
    expect(await snapshot(db)).toEqual(before);
    expect(sent).toEqual([]);
  });

  it("ignores texts we sent, calls and contact updates", async () => {
    const before = await snapshot(db);
    const out = text(a.phone, "Approved.", "8");
    await POST(request({ ...out, message: { ...out.message, status: "delivered", sent_at: "2026-11-17 10:00:00", received_at: null } }));
    await POST(request({ ...out, message: { ...out.message, type: "call" } }));
    await POST(request({ contact: { number: a.phone, opt_out: true } }));
    expect(await snapshot(db)).toEqual(before);
    expect(sent).toEqual([]);
  });

  it("stores a retried message id once", async () => {
    await POST(request(text(a.phone, "make it shorter", "9")));
    const before = await counts();
    await POST(request(text(a.phone, "make it shorter", "9")));
    expect(await counts()).toEqual(before);
    expect(sent[1]?.message).toBe(sent[0]?.message);
  });

  it("gives an unknown number one short reply and stores nothing", async () => {
    const before = await snapshot(db);
    await POST(request(text("+16195550000", "new reel", "10")));
    await POST(request(text("+16195550000", "hello?", "11")));
    expect(sent).toHaveLength(1);
    expect(sent[0].message).toContain("This number isn't linked to an account");
    expect(await snapshot(db)).toEqual(before);
  });

  it("stays silent on STOP, START and HELP and stores nothing", async () => {
    const before = await counts();
    for (const [i, word] of ["STOP", "start", "Help"].entries()) await POST(request(text(a.phone, word, `k${i}`)));
    await POST(request(text("+16195550001", "STOP", "k9")));
    expect(sent).toEqual([]);
    expect(await counts()).toEqual(before);
  });
});
