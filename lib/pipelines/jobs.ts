/**
 * Job queue helpers backed by the `jobs` table.
 *
 * - `enqueueJob` inserts a row with status='queued'
 * - `claimNextJob` atomically grabs the next due job via
 *   `SELECT ... FOR UPDATE SKIP LOCKED` so multiple cron workers cannot
 *   double-process the same row
 * - `completeJob` marks done
 * - `failJob` records the error and optionally re-queues with backoff
 *
 * All functions accept an injectable `db` so the cron handlers can use the
 * shared singleton while tests pass a mock.
 */

import { and, asc, eq, lte, sql } from "drizzle-orm";
import { db as defaultDb, schema } from "@/lib/db";
import type { JobKind } from "@/lib/db/enums";
import type { JobPayload } from "@/lib/db/types";

export type DbOrTx = typeof defaultDb;

export interface EnqueueJobInput {
  kind: JobKind;
  brandId?: string | null;
  payload?: JobPayload;
  /** When omitted, defaults to NOW() (immediately runnable). */
  scheduledFor?: Date;
}

export async function enqueueJob(
  input: EnqueueJobInput,
  db: DbOrTx = defaultDb,
): Promise<string> {
  const rows = await db
    .insert(schema.jobs)
    .values({
      kind: input.kind,
      brandId: input.brandId ?? null,
      payloadJson: input.payload ?? {},
      scheduledFor: input.scheduledFor ?? new Date(),
      status: "queued",
    })
    .returning({ id: schema.jobs.id });
  return rows[0]!.id;
}

export interface ClaimedJob {
  id: string;
  kind: JobKind;
  brandId: string | null;
  payload: JobPayload;
  attempts: number;
}

/**
 * Atomically claim the next due job. Uses Postgres
 * `FOR UPDATE SKIP LOCKED` semantics so concurrent cron invocations do not
 * race. Returns `null` when nothing is ready.
 *
 * Implementation: a CTE + UPDATE so the transition queued→running happens
 * inside one statement and SKIP LOCKED is honoured. The neon-http driver does
 * not expose a streaming `.for()` builder, so we use raw SQL for portability.
 */
export async function claimNextJob(
  kind?: JobKind,
  db: DbOrTx = defaultDb,
): Promise<ClaimedJob | null> {
  const kindFilter = kind ? sql`AND kind = ${kind}` : sql``;
  const result = await db.execute(sql`
    WITH next_job AS (
      SELECT id FROM jobs
      WHERE status = 'queued'
        AND scheduled_for <= NOW()
        ${kindFilter}
      ORDER BY scheduled_for ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    UPDATE jobs j
       SET status = 'running',
           started_at = NOW(),
           attempts = j.attempts + 1
      FROM next_job
     WHERE j.id = next_job.id
    RETURNING j.id, j.kind, j.brand_id, j.payload_json, j.attempts
  `);

  // neon-http returns `{ rows: [...] }`; drizzle's typing on `.execute` is loose.
  const rows = (result as unknown as { rows?: Array<Record<string, unknown>> })
    .rows;
  if (!rows || rows.length === 0) return null;
  const row = rows[0]!;
  return {
    id: String(row.id),
    kind: row.kind as JobKind,
    brandId: (row.brand_id as string | null) ?? null,
    payload: (row.payload_json as JobPayload) ?? {},
    attempts: Number(row.attempts ?? 0),
  };
}

export async function completeJob(
  id: string,
  db: DbOrTx = defaultDb,
): Promise<void> {
  await db
    .update(schema.jobs)
    .set({ status: "done", completedAt: new Date() })
    .where(eq(schema.jobs.id, id));
}

export interface FailJobOptions {
  /** When set, re-queue with `scheduled_for = NOW() + delay`. */
  retryDelaySeconds?: number;
  /** Hard cap on attempts; beyond this we stay 'failed' regardless. */
  maxAttempts?: number;
}

/**
 * Mark a running job as failed. If `retryDelaySeconds` is supplied and the
 * current attempts count is below `maxAttempts`, the row is flipped back to
 * 'queued' with the next `scheduled_for`. Otherwise it stays terminal-failed
 * and surfaces in `system_alerts`.
 *
 * Returns the resulting status for caller logging.
 */
export async function failJob(
  id: string,
  errorMessage: string,
  options: FailJobOptions = {},
  db: DbOrTx = defaultDb,
): Promise<"failed" | "queued"> {
  // Read current attempts to decide whether to re-queue.
  const current = await db
    .select({ attempts: schema.jobs.attempts })
    .from(schema.jobs)
    .where(eq(schema.jobs.id, id))
    .limit(1);
  const attempts = current[0]?.attempts ?? 0;

  const cap = options.maxAttempts ?? Infinity;
  const shouldRetry =
    options.retryDelaySeconds != null && attempts < cap;

  if (shouldRetry) {
    const nextRunAt = new Date(
      Date.now() + (options.retryDelaySeconds ?? 0) * 1000,
    );
    await db
      .update(schema.jobs)
      .set({
        status: "queued",
        scheduledFor: nextRunAt,
        lastError: errorMessage,
        startedAt: null,
      })
      .where(eq(schema.jobs.id, id));
    return "queued";
  }

  await db
    .update(schema.jobs)
    .set({
      status: "failed",
      lastError: errorMessage,
      completedAt: new Date(),
    })
    .where(eq(schema.jobs.id, id));
  return "failed";
}

/**
 * Worker loop: claim → run → complete/fail, up to `max` iterations.
 *
 * The cron handlers drive this with a bounded budget so a single invocation
 * cannot exceed the Vercel cron timeout. Each handler may pass its own
 * `runner` mapping job kinds to async handlers.
 */
export type JobRunner = (job: ClaimedJob) => Promise<void>;

export async function drainJobs(
  runner: JobRunner,
  options: { max?: number; kind?: JobKind; db?: DbOrTx } = {},
): Promise<{ processed: number; failed: number }> {
  const max = options.max ?? 25;
  const db = options.db ?? defaultDb;
  let processed = 0;
  let failed = 0;
  for (let i = 0; i < max; i++) {
    const job = await claimNextJob(options.kind, db);
    if (!job) break;
    try {
      await runner(job);
      await completeJob(job.id, db);
      processed++;
    } catch (err) {
      failed++;
      await failJob(
        job.id,
        err instanceof Error ? err.message : String(err),
        { retryDelaySeconds: 60, maxAttempts: 3 },
        db,
      );
    }
  }
  return { processed, failed };
}

// Re-export internals used by tests / introspection.
export { schema as __schema };
export const __internals = { and, asc, eq, lte, sql };
