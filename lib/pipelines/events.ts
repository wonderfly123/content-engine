/**
 * Audit log helper — writes a row to the `events` table for every state
 * transition that the pipeline modules perform.
 *
 * Kept tiny so it composes inside Drizzle transactions without ceremony.
 */

import { db as defaultDb, schema } from "@/lib/db";
import type { EventActor } from "@/lib/db/enums";

/** Drizzle DB or a tx handle that exposes `.insert`. */
export type DbOrTx = typeof defaultDb;

export interface RecordEventInput {
  entityType:
    | "brief"
    | "draft"
    | "post"
    | "asset"
    | "brand"
    | "research_bundle"
    | "job"
    | (string & {});
  entityId: string;
  fromStatus?: string | null;
  toStatus?: string | null;
  actor?: EventActor;
  note?: string | null;
}

/**
 * Insert one row into `events`. Returns the inserted id.
 *
 * `db` is injectable so callers can pass a Drizzle tx and so tests can pass
 * a mock that captures the inserted row.
 */
export async function recordEvent(
  input: RecordEventInput,
  db: DbOrTx = defaultDb,
): Promise<string> {
  const rows = await db
    .insert(schema.events)
    .values({
      entityType: input.entityType,
      entityId: input.entityId,
      fromStatus: input.fromStatus ?? null,
      toStatus: input.toStatus ?? null,
      actor: input.actor ?? "system",
      note: input.note ?? null,
    })
    .returning({ id: schema.events.id });
  return rows[0]!.id;
}
