import { describe, expect, it } from "vitest";
import { accessFromClaims, bearerFrom, decideAccess, hostRedirect, initialAccess, type Access } from "../access";

const user = (over: Partial<Access> = {}): Access => ({ userId: "u1", email: "a@b.co", role: "user", status: "active", ...over });

describe("accessFromClaims", () => {
  it("returns null without a subject", () => {
    expect(accessFromClaims(null)).toBeNull();
    expect(accessFromClaims({ email: "a@b.co" })).toBeNull();
  });
  it("treats a signed-in user with no metadata as a pending user", () => {
    expect(accessFromClaims({ sub: "u1", email: "a@b.co" })).toEqual({ userId: "u1", email: "a@b.co", role: "user", status: "pending" });
  });
  it("reads role and status from app_metadata and ignores unknown values", () => {
    expect(accessFromClaims({ sub: "u1", app_metadata: { ce_role: "admin", ce_status: "active" } })).toMatchObject({ role: "admin", status: "active" });
    expect(accessFromClaims({ sub: "u1", app_metadata: { ce_role: "owner", ce_status: "vip" } })).toMatchObject({ role: "user", status: "pending" });
  });
  it("never trusts user_metadata, which users can edit themselves", () => {
    expect(accessFromClaims({ sub: "u1", user_metadata: { ce_role: "admin", ce_status: "active" } })).toMatchObject({ role: "user", status: "pending" });
  });
});

describe("decideAccess", () => {
  it("sends anonymous visitors to login and rejects anonymous API calls", () => {
    expect(decideAccess("/dashboard", null)).toEqual({ kind: "redirect", to: "/login" });
    expect(decideAccess("/api/brands", null)).toMatchObject({ kind: "deny", status: 401 });
    expect(decideAccess("/login", null)).toEqual({ kind: "allow" });
    expect(decideAccess("/auth/callback", null)).toEqual({ kind: "allow" });
  });
  it("lets Salesmsg's webhook through without a session (it checks its token itself)", () => {
    expect(decideAccess("/api/salesmsg/sms", null)).toEqual({ kind: "allow" });
    // Only that prefix: the app's conversation routes still need a session.
    expect(decideAccess("/api/conversations", null)).toMatchObject({ kind: "deny", status: 401 });
    expect(decideAccess("/api/salesmsg-other", null)).toMatchObject({ kind: "deny", status: 401 });
  });
  it("lets the optimizer's callback through without a session (it checks the worker's signature itself)", () => {
    expect(decideAccess("/api/media/optimized", null)).toEqual({ kind: "allow" });
    // Only that path: reading a file still needs a session.
    expect(decideAccess("/api/media/00000000-0000-4000-8000-000000000001", null)).toMatchObject({ kind: "deny", status: 401 });
    expect(decideAccess("/api/media/optimized-other", null)).toMatchObject({ kind: "deny", status: 401 });
  });
  it("holds disabled users on the disabled page", () => {
    const status = "disabled" as const;
    expect(decideAccess("/calendar", user({ status }))).toEqual({ kind: "redirect", to: "/pending" });
    expect(decideAccess("/pending", user({ status }))).toEqual({ kind: "allow" });
    expect(decideAccess("/api/reels", user({ status }))).toMatchObject({ kind: "deny", status: 403 });
    expect(decideAccess("/api/admin/users", user({ status, role: "admin" }))).toMatchObject({ kind: "deny", status: 403 });
  });
  it("sends someone who is signed in but not set up yet to be set up, and gives them no data meanwhile", () => {
    const status = "pending" as const;
    expect(decideAccess("/calendar", user({ status }))).toEqual({ kind: "redirect", to: "/auth/welcome" });
    expect(decideAccess("/pending", user({ status }))).toEqual({ kind: "redirect", to: "/auth/welcome" });
    expect(decideAccess("/auth/welcome", user({ status }))).toEqual({ kind: "allow" });
    expect(decideAccess("/api/brands", user({ status }))).toMatchObject({ kind: "deny", status: 403 });
    expect(decideAccess("/api/admin/users", user({ status, role: "admin" }))).toMatchObject({ kind: "deny", status: 403 });
  });
  it("lets active users in but keeps admin areas for admins", () => {
    expect(decideAccess("/calendar", user())).toEqual({ kind: "allow" });
    expect(decideAccess("/admin", user())).toEqual({ kind: "redirect", to: "/dashboard" });
    expect(decideAccess("/api/admin/connections", user())).toMatchObject({ kind: "deny", status: 403 });
    expect(decideAccess("/admin", user({ role: "admin" }))).toEqual({ kind: "allow" });
    expect(decideAccess("/api/admin/users", user({ role: "admin" }))).toEqual({ kind: "allow" });
  });
  it("does not treat look-alike paths as public or admin", () => {
    expect(decideAccess("/loginx", null)).toEqual({ kind: "redirect", to: "/login" });
    expect(decideAccess("/administrator", user())).toEqual({ kind: "allow" });
  });
  it("moves approved users off the login and pending pages", () => {
    expect(decideAccess("/login", user())).toEqual({ kind: "redirect", to: "/dashboard" });
    expect(decideAccess("/pending", user())).toEqual({ kind: "redirect", to: "/dashboard" });
  });
});

describe("initialAccess", () => {
  it("makes the first account the admin and everyone else an active user, with no approval step", () => {
    expect(initialAccess(0)).toEqual({ role: "admin", status: "active" });
    expect(initialAccess(1)).toEqual({ role: "user", status: "active" });
  });
});

describe("public website", () => {
  it("lets anyone read the landing and policy pages", () => {
    for (const p of ["/", "/privacy", "/terms", "/texting"]) expect(decideAccess(p, null)).toEqual({ kind: "allow" });
    expect(decideAccess("/privacyx", null)).toEqual({ kind: "redirect", to: "/login" });
  });
});

describe("hostRedirect", () => {
  const go = (host: string, path: string) => hostRedirect(host, path, "nekter.io", "app.nekter.io");
  it("keeps the public pages on the bare domain and sends everything else to the app", () => {
    expect(go("nekter.io", "/")).toBeNull();
    expect(go("nekter.io", "/privacy")).toBeNull();
    expect(go("www.nekter.io", "/texting")).toBeNull();
    expect(go("nekter.io", "/api/salesmsg/sms")).toBeNull();
    expect(go("nekter.io", "/login")).toBe("https://app.nekter.io/login");
    expect(go("nekter.io", "/calendar")).toBe("https://app.nekter.io/calendar");
  });
  it("starts the app at the dashboard and sends the public pages to the website", () => {
    expect(go("app.nekter.io", "/")).toBe("/dashboard");
    expect(go("app.nekter.io", "/terms")).toBe("https://nekter.io/terms");
    expect(go("app.nekter.io", "/login")).toBeNull();
  });
  it("leaves other hosts alone", () => {
    expect(go("content-engine-tau-swart.vercel.app", "/login")).toBeNull();
    expect(go("localhost:3000", "/")).toBeNull();
  });
});

describe("bearerFrom", () => {
  it("reads a JWT from an Authorization header, and nothing else", () => {
    expect(bearerFrom("Bearer aaa.bbb.ccc")).toBe("aaa.bbb.ccc");
    expect(bearerFrom("  Bearer a-_1.b-_2.c-_3 ")).toBe("a-_1.b-_2.c-_3");
    expect(bearerFrom(null)).toBeNull();
    expect(bearerFrom("")).toBeNull();
    expect(bearerFrom("Basic dXNlcjpwYXNz")).toBeNull();
    expect(bearerFrom("Bearer not-a-jwt")).toBeNull();
    expect(bearerFrom("Bearer aaa.bbb.ccc extra")).toBeNull();
  });
});
