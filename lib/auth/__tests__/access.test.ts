import { describe, expect, it } from "vitest";
import { accessFromClaims, decideAccess, initialAccess, type Access } from "../access";

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
  it("holds pending and disabled users on the pending page", () => {
    for (const status of ["pending", "disabled"] as const) {
      expect(decideAccess("/calendar", user({ status }))).toEqual({ kind: "redirect", to: "/pending" });
      expect(decideAccess("/pending", user({ status }))).toEqual({ kind: "allow" });
      expect(decideAccess("/api/reels", user({ status }))).toMatchObject({ kind: "deny", status: 403 });
      expect(decideAccess("/api/admin/users", user({ status, role: "admin" }))).toMatchObject({ kind: "deny", status: 403 });
    }
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
  it("makes the first account the admin and everyone else pending", () => {
    expect(initialAccess(0)).toEqual({ role: "admin", status: "active" });
    expect(initialAccess(1)).toEqual({ role: "user", status: "pending" });
  });
});
