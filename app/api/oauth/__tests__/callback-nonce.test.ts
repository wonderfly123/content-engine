import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL ??= "postgres://test:test@localhost/test";
  process.env.TOKEN_ENCRYPTION_KEY ??= "0000000000000000000000000000000000000000000000000000000000000000";
  delete process.env.META_APP_ID;
  delete process.env.META_APP_SECRET;
});

vi.mock("@/lib/auth/workspace", () => ({
  guard: <A extends unknown[]>(handler: (...args: A) => unknown) => handler,
  requireBrand: async (brandId: string) => ({ brandId }),
}));

const { GET } = await import("../meta/callback/route");

const BRAND = "11111111-1111-4111-8111-111111111111";
const call = (nonce: string | null, cookie?: string) => {
  const state = nonce === null ? BRAND : `${BRAND}|${nonce}`;
  const headers = cookie ? { cookie: `ce_meta_oauth=${cookie}` } : undefined;
  return GET(new NextRequest(`http://localhost/api/oauth/meta/callback?code=abc&state=${encodeURIComponent(state)}`, { headers }));
};
const refusedForNonce = async (res: Response) => res.status === 400 && /not started from this browser/.test(JSON.stringify(await res.json()));

describe("Meta sign-in return", () => {
  it("is refused when this browser never started a sign-in", async () => {
    expect(await refusedForNonce(await call("abc"))).toBe(true);
  });
  it("is refused when the value does not match the one this browser set", async () => {
    expect(await refusedForNonce(await call("attacker-value", "my-value"))).toBe(true);
  });
  it("is refused when the link carries no value at all", async () => {
    expect(await refusedForNonce(await call(null, "my-value"))).toBe(true);
  });
  it("goes on to the next step when the values match", async () => {
    expect(await refusedForNonce(await call("my-value", "my-value"))).toBe(false);
  });
});
