/**
 * Storage the platform pays for, capped per workspace. Uploaded files land on the platform's
 * file store, so every workspace gets a fixed allowance until paid add-ons exist.
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";

/** Included storage per workspace. */
export const STORAGE_LIMIT_BYTES = 5 * 1024 * 1024 * 1024;

/**
 * Bytes of uploaded files across the workspace: its brands' assets plus its media objects on R2
 * (clips still uploading count, so a batch cannot overshoot; deleted ones do not).
 */
export async function workspaceStorageBytes(workspaceId: string): Promise<number> {
  const [assets] = await db
    .select({ bytes: sql<string>`coalesce(sum(${schema.assets.sizeBytes}), 0)` })
    .from(schema.assets)
    .innerJoin(schema.brands, eq(schema.brands.id, schema.assets.brandId))
    .where(eq(schema.brands.workspaceId, workspaceId));
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

export async function storageRoom(workspaceId: string, limitBytes: number = STORAGE_LIMIT_BYTES): Promise<StorageRoom> {
  const usedBytes = await workspaceStorageBytes(workspaceId);
  return { usedBytes, limitBytes, full: usedBytes >= limitBytes };
}

/** The body of a 413 answer when a workspace is out of storage. */
export function storageFullBody(room: StorageRoom) {
  const gb = (n: number) => (n / 1024 ** 3).toFixed(1);
  return { error: "storage_limit", message: `This workspace has used ${gb(room.usedBytes)} GB of its ${gb(room.limitBytes)} GB of storage. Archive or delete files to upload more.`, ...room };
}
