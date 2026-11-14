/**
 * For command-line scripts only (seeding, local connect): which workspace a new brand goes into.
 * Scripts have no signed-in user, so the workspace is named with WORKSPACE_ID, or is the only
 * one that exists. The app itself never uses this; it asks lib/auth/workspace.ts.
 */
import { db, schema } from "./index";

export async function workspaceForScript(): Promise<string> {
  const named = process.env.WORKSPACE_ID;
  if (named) return named;
  const all = await db.select({ id: schema.workspaces.id, name: schema.workspaces.name }).from(schema.workspaces).limit(2);
  if (all.length === 1) return all[0].id;
  throw new Error(all.length === 0 ? "No workspace exists yet; sign in to the app once first." : "More than one workspace exists; set WORKSPACE_ID to choose one.");
}
