import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { seedWorkspace, tableNames, type Seeded, type TestDb } from "@/app/api/__tests__/separation/world";

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

import { checkCredentials } from "../check";
import { llmForBrand, researcherForBrand } from "../clients";
import { getCredential, getCredentialForBrand, listCredentials, MissingCredentialError, removeCredential, saveCredential } from "../store";
import { verifyCredential } from "../verify";

let db: TestDb;
let a: Seeded;
let b: Seeded;

const respond = (status: number) => (async () => new Response("{}", { status })) as unknown as typeof fetch;

beforeEach(async () => {
  db = (await import("@/lib/db")).db as unknown as TestDb;
  const names = (await tableNames(db)).map((n) => `"${n}"`).join(", ");
  await db.execute(sql.raw(`truncate table ${names} cascade`));
  a = await seedWorkspace(db, "Alpha", "00000000-0000-4000-8000-00000000000a");
  b = await seedWorkspace(db, "Beta", "00000000-0000-4000-8000-00000000000b");
});

describe("workspace keys", () => {
  it("stores a key encrypted and gives it back only on the server", async () => {
    await saveCredential(a.workspaceId, "apify", "apify-secret-value");
    expect(await getCredential(a.workspaceId, "apify")).toBe("apify-secret-value");
    const raw = (await db.execute(sql`select secret from workspace_credentials where provider = 'apify'`)).rows as Array<{ secret: string }>;
    expect(raw).toHaveLength(1);
    expect(raw[0].secret).not.toContain("apify-secret-value");
  });

  it("never includes a secret in what the browser may see", async () => {
    const listed = await listCredentials(a.workspaceId);
    expect(listed.map((c) => [c.provider, c.connected])).toEqual([["anthropic", true], ["firecrawl", true], ["apify", false]]);
    expect(JSON.stringify(listed)).not.toContain("Alpha-anthropic-key");
    expect(JSON.stringify(listed)).not.toMatch(/secret/i);
  });

  it("gives each brand its own workspace's key, never another's", async () => {
    expect(await getCredentialForBrand(a.brandId, "anthropic")).toBe("Alpha-anthropic-key");
    expect(await getCredentialForBrand(b.brandId, "anthropic")).toBe("Beta-anthropic-key");
    await removeCredential(b.workspaceId, "anthropic");
    expect(await getCredentialForBrand(b.brandId, "anthropic")).toBeNull();
    expect(await getCredentialForBrand(a.brandId, "anthropic")).toBe("Alpha-anthropic-key");
  });

  it("replaces a key and clears a failing status", async () => {
    await db.execute(sql`update workspace_credentials set status = 'failing', last_check_error = 'rejected'`);
    await saveCredential(a.workspaceId, "anthropic", "new-key-value");
    const [anthropic] = await listCredentials(a.workspaceId);
    expect(anthropic).toMatchObject({ connected: true, status: "ok", lastCheckError: null });
    expect(await getCredential(a.workspaceId, "anthropic")).toBe("new-key-value");
  });

  it("refuses to build a client without the workspace's key, with no shared fallback", async () => {
    process.env.ANTHROPIC_API_KEY = "shared-key-that-must-not-be-used";
    process.env.FIRECRAWL_API_KEY = "shared-key-that-must-not-be-used";
    try {
      await removeCredential(a.workspaceId, "anthropic");
      await removeCredential(a.workspaceId, "firecrawl");
      await expect(llmForBrand(a.brandId)).rejects.toBeInstanceOf(MissingCredentialError);
      await expect(researcherForBrand(a.brandId)).rejects.toBeInstanceOf(MissingCredentialError);
      await expect(llmForBrand(b.brandId)).resolves.toBeDefined();
    } finally {
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.FIRECRAWL_API_KEY;
    }
  });
});

describe("testing a key", () => {
  it("passes a key the service accepts", async () => {
    expect(await verifyCredential("anthropic", "k", respond(200))).toEqual({ ok: true });
  });
  it("fails a key the service rejects", async () => {
    expect(await verifyCredential("firecrawl", "k", respond(401))).toMatchObject({ ok: false, rejected: true });
  });
  it("does not call an outage a rejected key", async () => {
    expect(await verifyCredential("apify", "k", respond(503))).toMatchObject({ ok: false, rejected: false });
    const down = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect(await verifyCredential("apify", "k", down)).toMatchObject({ ok: false, rejected: false });
  });
  it("sends the key only to its own service", async () => {
    const seen: string[] = [];
    const spy = (async (url: string) => {
      seen.push(new URL(url).host);
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    await verifyCredential("anthropic", "k", spy);
    await verifyCredential("firecrawl", "k", spy);
    await verifyCredential("apify", "k", spy);
    expect(seen).toEqual(["api.anthropic.com", "api.firecrawl.dev", "api.apify.com"]);
  });
});

describe("hourly key check", () => {
  it("marks rejected keys as failing", async () => {
    expect(await checkCredentials(respond(401))).toEqual({ checked: 4, failing: 4 });
    expect((await listCredentials(a.workspaceId))[0]).toMatchObject({ status: "failing" });
  });
  it("leaves the status alone during an outage and recovers when the key works again", async () => {
    await checkCredentials(respond(401));
    await checkCredentials(respond(503));
    expect((await listCredentials(a.workspaceId))[0]).toMatchObject({ status: "failing" });
    await checkCredentials(respond(200));
    expect((await listCredentials(a.workspaceId))[0]).toMatchObject({ status: "ok", lastCheckError: null });
  });
});
