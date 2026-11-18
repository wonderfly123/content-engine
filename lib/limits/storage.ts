/**
 * Storage the platform pays for, capped per workspace. Uploaded files land on the platform's
 * file store, so every workspace gets a fixed allowance until paid add-ons exist.
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";

/** Included storage per workspace, unless the platform admin has set a different allowance. */
export const STORAGE_LIMIT_BYTES = 5 * 1024 * 1024 * 1024;

/** The workspace's allowance: its own if one is set, else the default. */
export async function workspaceStorageLimit(workspaceId: string): Promise<number> {
  const [row] = await db
    .select({ limit: schema.workspaces.storageLimitBytes })
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, workspaceId))
    .limit(1);
  return row?.limit && row.limit > 0 ? row.limit : STORAGE_LIMIT_BYTES;
}

/**
 * Bytes of uploaded files across the workspace: its brands' assets plus its media objects on R2
 * (clips still uploading count, so a batch cannot overshoot; deleted ones do not).
 */
export async function workspaceStorageBytes(workspaceId: string): Promise<number> {
  const [assets] = await db
    .select({ bytes: sql<string>`coalesce(sum(${schema.assets.sizeBytes}), 0)` })
    .from(schema.assets)
    .innerJoin(schema.brands, eq(schema.brands.id, schema.assets.brandId))
    // A library entry for an uploaded clip is the clip itself, already counted below.
    .where(and(eq(schema.brands.workspaceId, workspaceId), isNull(schema.assets.mediaObjectId)));
  const [media] = await db
    .select({ bytes: sql<string>`coalesce(sum(${schema.mediaObjects.sizeBytes}), 0)` })
    .from(schema.mediaObjects)
    .where(and(eq(schema.mediaObjects.workspaceId, workspaceId), isNull(schema.mediaObjects.deletedAt)));
  return Number(assets?.bytes ?? 0) + Number(media?.bytes ?? 0);
}

export interface StorageRoom {
  usedBytes: number;
  limitBytes: number;
  /** True when the workspace has used up its allowance. */
  full: boolean;
}

export async function storageRoom(workspaceId: string, limitOverride?: number): Promise<StorageRoom> {
  const [usedBytes, limitBytes] = await Promise.all([
    workspaceStorageBytes(workspaceId),
    limitOverride ?? workspaceStorageLimit(workspaceId),
  ]);
  return { usedBytes, limitBytes, full: usedBytes >= limitBytes };
}

/** The body of a 413 answer when a workspace is out of storage. */
export function storageFullBody(room: StorageRoom) {
  const gb = (n: number) => (n / 1024 ** 3).toFixed(1);
  return { error: "storage_limit", message: `This workspace has used ${gb(room.usedBytes)} GB of its ${gb(room.limitBytes)} GB of storage. Archive or delete files to upload more.`, ...room };
}
