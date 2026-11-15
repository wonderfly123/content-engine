/**
 * Sets a person up the first time they sign in: gives them their platform role and status, and
 * a workspace of their own with them as its owner. Safe to run on every sign-in; it only fills
 * in what is missing.
 */
import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { initialAccess, ROLE_KEY, STATUS_KEY } from "./access";

export interface SignedInUser {
  id: string;
  email?: string | null;
  app_metadata?: Record<string, unknown> | null;
  user_metadata?: Record<string, unknown> | null;
}

/** The slice of Supabase's admin API this needs (injected so tests need no Supabase). */
export interface UserAdmin {
  countActiveAdmins(): Promise<number>;
  setAppMetadata(userId: string, appMetadata: Record<string, unknown>): Promise<void>;
}

function workspaceName(user: SignedInUser): string {
  const full = typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name.trim() : "";
  const first = full.split(/\s+/)[0] || (user.email ?? "").split("@")[0] || "My";
  const name = first.charAt(0).toUpperCase() + first.slice(1);
  return name === "My" ? "My workspace" : `${name}'s workspace`.slice(0, 80);
}

/**
 * Makes sure the user belongs to a workspace, creating one (with them as owner) if they have
 * none. Returns true when it created one. A per-user lock stops two sign-ins at the same moment
 * from creating two.
 */
export async function ensureWorkspace(user: SignedInUser): Promise<boolean> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${user.id}))`);
    const [existing] = await tx
      .select({ workspaceId: schema.workspaceMembers.workspaceId })
      .from(schema.workspaceMembers)
      .where(eq(schema.workspaceMembers.userId, user.id))
      .limit(1);
    if (existing) return false;
    const [workspace] = await tx.insert(schema.workspaces).values({ name: workspaceName(user) }).returning({ id: schema.workspaces.id });
    await tx.insert(schema.workspaceMembers).values({ workspaceId: workspace.id, userId: user.id, role: "owner" });
    return true;
  });
}

/** Gives a first-time user their role and status. Returns true when it changed anything. */
export async function ensureAccess(user: SignedInUser, admin: UserAdmin): Promise<boolean> {
  const meta = (user.app_metadata ?? {}) as Record<string, unknown>;
  if (meta[STATUS_KEY]) return false;
  const first = initialAccess(await admin.countActiveAdmins());
  await admin.setAppMetadata(user.id, { ...meta, [ROLE_KEY]: first.role, [STATUS_KEY]: first.status });
  return true;
}

/**
 * Full set-up. Returns whether the session must be re-issued (so the new role and status are
 * inside the token) and whether the user is brand new to the app.
 */
export async function provisionUser(user: SignedInUser, admin: UserAdmin): Promise<{ refreshSession: boolean; isNew: boolean }> {
  const accessChanged = await ensureAccess(user, admin);
  const createdWorkspace = await ensureWorkspace(user);
  return { refreshSession: accessChanged, isNew: createdWorkspace };
}
