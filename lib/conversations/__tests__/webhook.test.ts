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

import { POST } from "@/app/api/twilio/sms/route";
import { resetUnknownNumberMemory } from "../handle";
import { twilioSignature } from "../twilio";

const TOKEN = "test-auth-token";
const PUBLIC = "https://app.test/api/twilio/sms";

let db: TestDb;
let a: Seeded;

function request(params: Record<string, string>, signature?: string | null, url = PUBLIC): NextRequest {
  const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded" };
  if (signature !== null) headers["x-twilio-signature"] = signature ?? twilioSignature(TOKEN, PUBLIC, params);
  return new NextRequest(url, { method: "POST", headers, body: new URLSearchParams(params).toString() });
}

const text = (from: string, body: string, sid: string) => ({ From: from, To: "+15550009999", Body: body, MessageSid: sid });
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
  process.env.TWILIO_AUTH_TOKEN = TOKEN;
  process.env.APP_URL = "https://app.test";
  resetUnknownNumberMemory();
});

afterEach(() => {
  delete process.env.TWILIO_AUTH_TOKEN;
  delete process.env.APP_URL;
});

describe("POST /api/twilio/sms", () => {
  it("refuses an unsigned request or a wrong signature with 403, writing nothing", async () => {
    const before = await snapshot(db);
    expect((await POST(request(text(a.phone, "new reel", "SM1"), null))).status).toBe(403);
    expect((await POST(request(text(a.phone, "new reel", "SM2"), "bm90IGl0"))).status).toBe(403);
    // Signed for different parameters.
    expect((await POST(request(text(a.phone, "new reel", "SM3"), twilioSignature(TOKEN, PUBLIC, text(a.phone, "other", "SM3"))))).status).toBe(403);
    expect(await snapshot(db)).toEqual(before);
  });

  it("refuses everything when the auth token is not set", async () => {
    const before = await snapshot(db);
    const req = request(text(a.phone, "new reel", "SM4"));
    delete process.env.TWILIO_AUTH_TOKEN;
    expect((await POST(req)).status).toBe(403);
    expect(await snapshot(db)).toEqual(before);
  });

  it("checks the signature against APP_URL, not the host the request reached", async () => {
    const params = text(a.phone, "make it shorter", "SM5");
    const res = await POST(request(params, twilioSignature(TOKEN, PUBLIC, params), "http://internal-host:3000/api/twilio/sms"));
    expect(res.status).toBe(200);
  });

  it("answers a confirmed member with TwiML and links to the thread", async () => {
    const res = await POST(request(text(a.phone, "New reel!", "SM6")));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/xml");
    const body = await res.text();
    expect(body).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?><Response><Message>New reel for Alpha brand started\. Send your clips in the app: https:\/\/app\.test\/conversations\/[0-9a-f-]{36}<\/Message><\/Response>$/);
  });

  it("stores a retried MessageSid once", async () => {
    const params = text(a.phone, "make it shorter", "SM7");
    const first = await (await POST(request(params))).text();
    const before = await counts();
    const second = await (await POST(request(params))).text();
    expect(second).toBe(first);
    expect(await counts()).toEqual(before);
  });

  it("gives an unknown number one short reply and stores nothing", async () => {
    const before = await snapshot(db);
    const first = await (await POST(request(text("+16195550000", "new reel", "SM8")))).text();
    expect(first).toContain("This number isn&apos;t linked to an account");
    const second = await (await POST(request(text("+16195550000", "hello?", "SM9")))).text();
    expect(second).toBe('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
    expect(await snapshot(db)).toEqual(before);
  });

  it("treats an unconfirmed number as unknown", async () => {
    await db.execute(sql`update member_phones set verified_at = null`);
    const body = await (await POST(request(text(a.phone, "new reel", "SM10")))).text();
    expect(body).toContain("This number isn&apos;t linked to an account");
    expect((await counts()).messages).toBe(1); // only the seeded message
  });

  it("stays silent on STOP, START and HELP and stores nothing", async () => {
    const before = await counts();
    for (const [i, word] of ["STOP", "start", "Help"].entries()) {
      const body = await (await POST(request(text(a.phone, word, `SM-k${i}`)))).text();
      expect(body).toBe('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
    }
    expect(await (await POST(request(text("+16195550001", "STOP", "SM-k9")))).text()).toBe('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
    expect(await counts()).toEqual(before);
  });
});
