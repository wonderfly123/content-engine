/**
 * Access to one media object by id. Media objects reach their workspace directly, so this sits
 * beside lib/auth/workspace.ts like requireConversation does: the signed-in caller (`requireUser`)
 * and their workspaces (`listMemberships`). An object outside the caller's workspaces, or one that
 * has been deleted, answers 404, the same as one that does not exist.
 *
 * Inside a conversation's upload routes, use `requireConversationMedia` instead: it also insists the
 * object belongs to that very conversation.
 */
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Access } from "@/lib/auth/access";
import { AccessError, listMemberships, requireUser } from "@/lib/auth/workspace";
import type { ConversationAccess } from "@/lib/conversations/access";
import { db, schema } from "@/lib/db";
import type { WorkspaceRole } from "@/lib/db/enums";
import { isWorkspaceKey } from "@/lib/storage/keys";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const notFound = () => new AccessError(404, "Not found.");

export type MediaRow = typeof schema.mediaObjects.$inferSelect;

export interface MediaAccess {
  user: Access;
  workspaceId: string;
  role: WorkspaceRole;
  media: MediaRow;
}

export async function requireMedia(id: unknown): Promise<MediaAccess> {
  const user = await requireUser();
  if (typeof id !== "string" || !UUID.test(id)) throw notFound();
  const memberships = await listMemberships(user.userId);
  if (memberships.length === 0) throw notFound();
  const [media] = await db
    .select()
    .from(schema.mediaObjects)
    .where(
      and(
        eq(schema.mediaObjects.id, id),
        inArray(schema.mediaObjects.workspaceId, memberships.map((m) => m.workspaceId)),
        isNull(schema.mediaObjects.deletedAt),
      ),
    )
    .limit(1);
  // The key must sit under the same workspace as the row; anything else is never signed.
  if (!media || !isWorkspaceKey(media.r2Key, media.workspaceId)) throw notFound();
  const membership = memberships.find((m) => m.workspaceId === media.workspaceId)!;
  return { user, workspaceId: media.workspaceId, role: membership.role, media };
}

/** A media object of this conversation (already checked with requireConversation), else 404. */
export async function requireConversationMedia(access: ConversationAccess, id: unknown): Promise<MediaRow> {
  if (typeof id !== "string" || !UUID.test(id)) throw notFound();
  const [media] = await db
    .select()
    .from(schema.mediaObjects)
    .where(
      and(
        eq(schema.mediaObjects.id, id),
        eq(schema.mediaObjects.conversationId, access.conversation.id),
        eq(schema.mediaObjects.workspaceId, access.workspaceId),
        isNull(schema.mediaObjects.deletedAt),
      ),
    )
    .limit(1);
  if (!media || !isWorkspaceKey(media.r2Key, access.workspaceId)) throw notFound();
  return media;
}
