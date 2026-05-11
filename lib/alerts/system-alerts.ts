/**
 * System alerts aggregation — Section 6 "Failure surfacing".
 *
 * A virtual feed computed from three sources:
 *   1. jobs.status='failed' AND attempts >= 3
 *   2. channel_connections.status IN ('expired','revoked','error')
 *   3. posts.status='failed' AND publish_attempts >= 3
 *
 * Returns one normalised `SystemAlert` shape per row regardless of source so
 * the UI can render a single list and dispatch actions by `kind`.
 *
 * DB is injectable for tests.
 */

import { and, desc, eq, gte, inArray, isNotNull } from "drizzle-orm";
import { db as defaultDb, schema } from "@/lib/db";
import type { Channel } from "@/lib/db/enums";

export type DbOrTx = typeof defaultDb;

export type SystemAlertKind = "job_failed" | "channel_disconnected" | "post_failed";

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

  const out: SystemAlert[] = [];

  // ---- 1. Failed jobs ------------------------------------------------------
  {
    const conds = [
      eq(schema.jobs.status, "failed"),
      gte(schema.jobs.attempts, 3),
    ];
    if (scopedBrand) conds.push(eq(schema.jobs.brandId, scopedBrand));
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
