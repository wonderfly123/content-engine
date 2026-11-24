/**
 * System alerts aggregation — Section 6 "Failure surfacing".
 *
 * A virtual feed computed from five sources:
 *   1. jobs.status='failed' AND attempts >= 3
 *   2. channel_connections.status IN ('expired','revoked','error')
 *   3. posts.status='failed' AND publish_attempts >= 3
 *   4. editor_jobs.status='failed' in the last few days (the worker's own reason)
 *   5. media_objects with an optimize_error in the last few days (kept at full size)
 *
 * Returns one normalised `SystemAlert` shape per row regardless of source so
 * the UI can render a single list and dispatch actions by `kind`.
 *
 * DB is injectable for tests.
 */

import { and, desc, eq, gte, inArray, isNotNull, isNull } from "drizzle-orm";
import { db as defaultDb, schema } from "@/lib/db";
import type { Channel } from "@/lib/db/enums";

export type DbOrTx = typeof defaultDb;

export type SystemAlertKind = "job_failed" | "channel_disconnected" | "post_failed" | "edit_failed" | "clip_not_shrunk";

/** Failed edits and clips that could not be shrunk stay on the list this long. */
const PIPELINE_ALERT_DAYS = 3;

export interface SystemAlert {
  id: string; // synthetic: `<kind>:<entityId>`
  kind: SystemAlertKind;
  brandId: string | null;
  title: string;
  detail: string;
  /** Optional anchor row id (job, channel_connection, or post). */
  entityId: string;
  /** Optional channel (for post_failed / channel_disconnected). */
  channel?: Channel;
  at: Date;
}

export interface ListAlertsOptions {
  /** When set, restrict to one brand. When null/undefined, return all brands. */
  brandId?: string | null;
  /**
   * Restrict to these brands (the caller's). An empty list returns nothing. Callers acting for a
   * signed-in user must pass this or `brandId`; rows with no brand are then left out.
   */
  brandIds?: string[];
  /** Limit per source (defaults to 50). */
  limit?: number;
  db?: DbOrTx;
}

export async function listSystemAlerts(
  options: ListAlertsOptions = {},
): Promise<SystemAlert[]> {
  const db = options.db ?? defaultDb;
  const limit = options.limit ?? 50;
  const scopedBrand = options.brandId;
  const brandIds = options.brandIds;
  if (brandIds && brandIds.length === 0) return [];

  const out: SystemAlert[] = [];

  // ---- 1. Failed jobs ------------------------------------------------------
  {
    const conds = [
      eq(schema.jobs.status, "failed"),
      gte(schema.jobs.attempts, 3),
    ];
    if (scopedBrand) conds.push(eq(schema.jobs.brandId, scopedBrand));
    if (brandIds) conds.push(inArray(schema.jobs.brandId, brandIds));
    const rows = await db
      .select({
        id: schema.jobs.id,
        kind: schema.jobs.kind,
        brandId: schema.jobs.brandId,
        lastError: schema.jobs.lastError,
        completedAt: schema.jobs.completedAt,
        scheduledFor: schema.jobs.scheduledFor,
      })
      .from(schema.jobs)
      .where(and(...conds))
      .orderBy(desc(schema.jobs.completedAt))
      .limit(limit);

    for (const r of rows) {
      out.push({
        id: `job_failed:${r.id}`,
        kind: "job_failed",
        brandId: r.brandId,
        title: `Job ${r.kind} failed`,
        detail: r.lastError ?? "Unknown error",
        entityId: String(r.id),
        at: r.completedAt ?? r.scheduledFor ?? new Date(),
      });
    }
  }

  // ---- 2. Bad channel connections -----------------------------------------
  {
    const conds = [
      inArray(schema.channelConnections.status, [
        "expired",
        "revoked",
        "error",
      ]),
    ];
    if (scopedBrand) conds.push(eq(schema.channelConnections.brandId, scopedBrand));
    if (brandIds) conds.push(inArray(schema.channelConnections.brandId, brandIds));
    const rows = await db
      .select({
        id: schema.channelConnections.id,
        brandId: schema.channelConnections.brandId,
        channel: schema.channelConnections.channel,
        status: schema.channelConnections.status,
        connectedAt: schema.channelConnections.connectedAt,
      })
      .from(schema.channelConnections)
      .where(and(...conds))
      .orderBy(desc(schema.channelConnections.connectedAt))
      .limit(limit);

    for (const r of rows) {
      const ch = String(r.channel);
      const label = ch.charAt(0).toUpperCase() + ch.slice(1);
      out.push({
        id: `channel_disconnected:${r.id}`,
        kind: "channel_disconnected",
        brandId: r.brandId,
        title: `${label} connection ${r.status}`,
        detail: `Reconnect ${label} to resume publishing.`,
        entityId: String(r.id),
        channel: r.channel as Channel,
        at: r.connectedAt ?? new Date(),
      });
    }
  }

  // ---- 3. Failed posts -----------------------------------------------------
  {
    const conds = [
      eq(schema.posts.status, "failed"),
      gte(schema.posts.publishAttempts, 3),
    ];
    if (scopedBrand) conds.push(eq(schema.posts.brandId, scopedBrand));
    if (brandIds) conds.push(inArray(schema.posts.brandId, brandIds));
    const rows = await db
      .select({
        id: schema.posts.id,
        brandId: schema.posts.brandId,
        channel: schema.posts.channel,
        publishError: schema.posts.publishError,
        lastErrorAt: schema.posts.lastErrorAt,
        updatedAt: schema.posts.updatedAt,
      })
      .from(schema.posts)
      .where(and(...conds, isNotNull(schema.posts.publishError)))
      .orderBy(desc(schema.posts.lastErrorAt))
      .limit(limit);

    for (const r of rows) {
      out.push({
        id: `post_failed:${r.id}`,
        kind: "post_failed",
        brandId: r.brandId,
        title: "Post failed to publish",
        detail: r.publishError ?? "Unknown error",
        entityId: String(r.id),
        channel: r.channel as Channel,
        at: r.lastErrorAt ?? r.updatedAt ?? new Date(),
      });
    }
  }

  // ---- 4. Edits that failed, with the worker's own reason ---------------------
  const since = new Date(Date.now() - PIPELINE_ALERT_DAYS * 24 * 60 * 60 * 1000);
  {
    const conds = [eq(schema.editorJobs.status, "failed"), gte(schema.editorJobs.updatedAt, since)];
    if (scopedBrand) conds.push(eq(schema.editorJobs.brandId, scopedBrand));
    if (brandIds) conds.push(inArray(schema.editorJobs.brandId, brandIds));
    const rows = await db
      .select({
        id: schema.editorJobs.id,
        brandId: schema.editorJobs.brandId,
        conversationId: schema.editorJobs.conversationId,
        editError: schema.editorJobs.error,
        finishedAt: schema.editorJobs.finishedAt,
        updatedAt: schema.editorJobs.updatedAt,
      })
      .from(schema.editorJobs)
      .where(and(...conds))
      .orderBy(desc(schema.editorJobs.updatedAt))
      .limit(limit);
    for (const r of rows) {
      out.push({
        id: `edit_failed:${r.id}`,
        kind: "edit_failed",
        brandId: r.brandId,
        title: "An edit failed",
        detail: r.editError ?? "No reason was recorded.",
        // The chat it happened in, so the alert can link there.
        entityId: String(r.conversationId),
        at: r.finishedAt ?? r.updatedAt ?? new Date(),
      });
    }
  }

  // ---- 5. Clips that could not be shrunk (still usable, at full size) ---------
  {
    const conds = [isNotNull(schema.mediaObjects.optimizeError), isNull(schema.mediaObjects.deletedAt), gte(schema.mediaObjects.updatedAt, since)];
    if (scopedBrand) conds.push(eq(schema.mediaObjects.brandId, scopedBrand));
    if (brandIds) conds.push(inArray(schema.mediaObjects.brandId, brandIds));
    const rows = await db
      .select({
        id: schema.mediaObjects.id,
        brandId: schema.mediaObjects.brandId,
        conversationId: schema.mediaObjects.conversationId,
        filename: schema.mediaObjects.filename,
        optimizeError: schema.mediaObjects.optimizeError,
        updatedAt: schema.mediaObjects.updatedAt,
      })
      .from(schema.mediaObjects)
      .where(and(...conds))
      .orderBy(desc(schema.mediaObjects.updatedAt))
      .limit(limit);
    for (const r of rows) {
      out.push({
        id: `clip_not_shrunk:${r.id}`,
        kind: "clip_not_shrunk",
        brandId: r.brandId,
        title: `${r.filename} was kept at full size`,
        detail: r.optimizeError ?? "No reason was recorded.",
        entityId: String(r.conversationId ?? r.id),
        at: r.updatedAt ?? new Date(),
      });
    }
  }

  // Newest first; dedupe by synthetic id (kind+entity) just in case.
  const seen = new Set<string>();
  const deduped: SystemAlert[] = [];
  for (const a of out.sort((x, y) => y.at.getTime() - x.at.getTime())) {
    if (seen.has(a.id)) continue;
    seen.add(a.id);
    deduped.push(a);
  }
  return deduped;
}

export async function countSystemAlerts(
  options: ListAlertsOptions = {},
): Promise<number> {
  const all = await listSystemAlerts(options);
  return all.length;
}
