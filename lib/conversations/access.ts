/**
 * Access to one thread by id. Threads reach their workspace directly (not through a brand), so
 * this sits beside lib/auth/workspace.ts and is built from its parts: the signed-in caller
 * (`requireUser`) and their workspaces (`listMemberships`). A thread outside the caller's
 * workspaces answers 404, the same as one that does not exist.
 *
 * Everything that reads or writes a thread by id goes through `requireConversation`.
 */
import { and, eq, inArray } from "drizzle-orm";
import type { Access } from "@/lib/auth/access";
import { AccessError, listMemberships, requireUser } from "@/lib/auth/workspace";
import { db, schema } from "@/lib/db";
import type { WorkspaceRole } from "@/lib/db/enums";
import type { ConversationRow } from "./store";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ConversationAccess {
  user: Access;
  workspaceId: string;
  role: WorkspaceRole;
  conversation: ConversationRow;
}

export async function requireConversation(id: unknown): Promise<ConversationAccess> {
  const user = await requireUser();
  if (typeof id !== "string" || !UUID.test(id)) throw new AccessError(404, "Not found.");
  const memberships = await listMemberships(user.userId);
  if (memberships.length === 0) throw new AccessError(404, "Not found.");
  const [conversation] = await db
    .select()
    .from(schema.conversations)
    .where(and(eq(schema.conversations.id, id), inArray(schema.conversations.workspaceId, memberships.map((m) => m.workspaceId))))
    .limit(1);
  if (!conversation) throw new AccessError(404, "Not found.");
  const membership = memberships.find((m) => m.workspaceId === conversation.workspaceId)!;
  return { user, workspaceId: conversation.workspaceId, role: membership.role, conversation };
}
