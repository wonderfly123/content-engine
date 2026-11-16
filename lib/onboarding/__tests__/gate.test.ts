import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  user: { userId: "u1", email: "a@example.com", role: "user", status: "active" } as Record<string, unknown> | null,
  memberships: [{ workspaceId: "w1", role: "owner" }] as unknown[],
  brands: [] as unknown[],
}));

vi.mock("@/lib/auth/workspace", () => ({
  requireUser: async () => {
    if (!state.user) throw new Error("Sign in required.");
    return state.user;
  },
  listMemberships: async () => state.memberships,
}));
vi.mock("@/lib/db", () => {
  const chain = {
    from: () => chain,
    innerJoin: () => chain,
    where: async () => state.brands,
  };
  return { db: { select: () => chain }, schema: { brands: {}, workspaceMembers: {}, workspaces: {} } };
});
vi.mock("drizzle-orm", () => ({ and: () => undefined, eq: () => undefined }));

import { onboardingRedirect } from "../gate";

beforeEach(() => {
  state.user = { userId: "u1", email: "a@example.com", role: "user", status: "active" };
  state.memberships = [{ workspaceId: "w1", role: "owner" }];
  state.brands = [];
});

describe("onboardingRedirect (the app layout's check)", () => {
  it("sends a signed-in user with no brands to onboarding", async () => {
    expect(await onboardingRedirect()).toBe("/onboarding");
  });

  it("does not redirect a user who has a brand", async () => {
    state.brands = [{ status: "active", settingsJson: {} }];
    expect(await onboardingRedirect()).toBeNull();
  });

  it("never redirects the platform admin", async () => {
    state.user = { ...state.user, role: "admin" };
    expect(await onboardingRedirect()).toBeNull();
  });

  it("fails open: no session, or a database error, means no redirect", async () => {
    state.user = null;
    expect(await onboardingRedirect()).toBeNull();
    state.user = { userId: "u1", role: "user", status: "active" };
    state.memberships = [];
    expect(await onboardingRedirect()).toBeNull();
  });
});
