/**
 * Sends a signed-in user who has no brand yet into onboarding (see `needsOnboarding` for the rule).
 * Fails open: any error, no session, or no workspace means no redirect, so nobody is ever trapped.
 */
import { and, eq } from "drizzle-orm";
import { listMemberships, requireUser } from "@/lib/auth/workspace";
import { db, schema } from "@/lib/db";
import { needsOnboarding } from "./flow";

export async function onboardingRedirect(): Promise<string | null> {
  try {
    const user = await requireUser();
    if (user.role === "admin") return null;
    const memberships = await listMemberships(user.userId);
    const rows = memberships.length
      ? await db
          .select({ status: schema.brands.status, settingsJson: schema.brands.settingsJson })
          .from(schema.brands)
          .innerJoin(schema.workspaceMembers, eq(schema.workspaceMembers.workspaceId, schema.brands.workspaceId))
          .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.brands.workspaceId))
          .where(and(eq(schema.workspaceMembers.userId, user.userId), eq(schema.workspaces.status, "active")))
      : [];
    return needsOnboarding({ isPlatformAdmin: false, hasWorkspace: memberships.length > 0, brands: rows }) ? "/onboarding" : null;
  } catch {
    return null;
  }
}
