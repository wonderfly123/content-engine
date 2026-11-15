/**
 * Shrinking on arrival. Every uploaded clip lands in `incoming/`; once complete it is `processing`
 * and a job goes to the optimizer on Modal (workers/optimize/app.py):
 *
 *   requestOptimize -> POST MODAL_OPTIMIZE_URL { jobId, mediaId, sourceUrl, outputUrl, callbackUrl }
 *   worker -> ffmpeg -> PUT outputUrl (ws/<ws>/conv/<conv>/raw/<id>.mp4) -> POST /api/media/optimized
 *   applyOptimizeResult -> the row points at the small copy, the original in incoming/ is deleted.
 *
 * The worker only gets two presigned links (2 hours): never keys, database access or other secrets.
 * The output key is derived from the row here, never taken from the worker.
 *
 * The user's footage is never lost: whenever optimizing cannot happen (not configured, the worker
 * unreachable or failing, the output missing or wrong, nothing heard back for 2 hours) the clip
 * becomes `ready` as uploaded, with the reason in `optimize_error`.
 */
import { randomUUID } from "node:crypto";
import { and, eq, isNull, lt } from "drizzle-orm";
import { z } from "zod";
import { appUrl } from "@/lib/conversations/twilio";
import { db, schema } from "@/lib/db";
import { buildOptimizedKey, isWorkspaceKey } from "@/lib/storage/keys";
import { deleteObject, headObject, presignGet, presignPut } from "@/lib/storage/r2";
import type { MediaRow } from "./access";
import { optimizeSecret } from "./worker-signature";

const { mediaObjects } = schema;

/** How long the worker's links stay valid. */
export const OPTIMIZE_LINK_SECONDS = 2 * 60 * 60;
/** A clip still processing after this long is given up on (the original is kept). */
export const STUCK_AFTER_MS = 2 * 60 * 60 * 1000;
export const CALLBACK_PATH = "/api/media/optimized";
const REQUEST_TIMEOUT_MS = 20_000;

export interface OptimizeJob {
  jobId: string;
  mediaId: string;
  sourceUrl: string;
  outputUrl: string;
  callbackUrl: string;
}

function optimizeConfig(): { url: string; secret: string } | null {
  const url = process.env.MODAL_OPTIMIZE_URL?.trim();
  const secret = optimizeSecret();
  return url && secret ? { url, secret } : null;
}

const optimizedKeyOf = (m: MediaRow): string | null =>
  m.conversationId ? buildOptimizedKey({ workspaceId: m.workspaceId, conversationId: m.conversationId, id: m.id }) : null;

/** Makes a processing clip `ready` as uploaded. With `jobId`, only while that job is still the current one. */
async function keepOriginal(m: MediaRow, error: string | null, jobId?: string): Promise<MediaRow | null> {
  const [row] = await db
    .update(mediaObjects)
    .set({ status: "ready", optimizeError: error, updatedAt: new Date() })
    .where(
      and(
        eq(mediaObjects.id, m.id),
        eq(mediaObjects.workspaceId, m.workspaceId),
        eq(mediaObjects.status, "processing"),
        ...(jobId ? [eq(mediaObjects.optimizeJobId, jobId)] : []),
      ),
    )
    .returning();
  return row ?? null;
}

/**
 * Sends a processing clip to the optimizer. Returns the row as it now stands: still `processing`
 * when the job was accepted, `ready` (original kept) otherwise. `origin` is the request's own address,
 * used for the callback when APP_URL is not set.
 */
export async function requestOptimize(mediaId: string, origin?: string | null): Promise<MediaRow | null> {
  const [media] = await db.select().from(mediaObjects).where(and(eq(mediaObjects.id, mediaId), isNull(mediaObjects.deletedAt))).limit(1);
  if (!media || media.status !== "processing") return media ?? null;

  const config = optimizeConfig();
  if (!config) {
    console.info(`[optimize] MODAL_OPTIMIZE_URL / MODAL_OPTIMIZE_SECRET not set: clip ${media.id} kept as uploaded.`);
    return keepOriginal(media, null);
  }
  const outputKey = optimizedKeyOf(media);
  if (!outputKey || !isWorkspaceKey(media.r2Key, media.workspaceId)) return keepOriginal(media, "The clip has no conversation to file the optimized copy under.");

  const jobId = randomUUID();
  const [row] = await db
    .update(mediaObjects)
    .set({ optimizeJobId: jobId, optimizeError: null, updatedAt: new Date() })
    .where(and(eq(mediaObjects.id, media.id), eq(mediaObjects.status, "processing")))
    .returning();
  if (!row) return media;

  let job: OptimizeJob;
  try {
    job = {
      jobId,
      mediaId: row.id,
      sourceUrl: presignGet(row.r2Key, OPTIMIZE_LINK_SECONDS),
      outputUrl: presignPut(outputKey, OPTIMIZE_LINK_SECONDS),
      callbackUrl: `${appUrl(origin)}${CALLBACK_PATH}`,
    };
  } catch {
    return keepOriginal(row, "Storage is not configured, so the clip was not optimized.", jobId);
  }

  try {
    const res = await fetch(config.url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${config.secret}` },
      body: JSON.stringify(job),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn(`[optimize] the optimizer refused clip ${row.id} (HTTP ${res.status}); kept as uploaded.`);
      return keepOriginal(row, `The optimizer refused the job (HTTP ${res.status}).`, jobId);
    }
  } catch {
    console.warn(`[optimize] the optimizer could not be reached for clip ${row.id}; kept as uploaded.`);
    return keepOriginal(row, "The optimizer could not be reached.", jobId);
  }
  return row;
}

const resultSchema = z.object({
  jobId: z.string().uuid(),
  mediaId: z.string().uuid(),
  ok: z.boolean(),
  sizeBytes: z.number().int().positive().optional(),
  width: z.number().int().positive().nullable().optional(),
  height: z.number().int().positive().nullable().optional(),
  durationSec: z.number().nonnegative().nullable().optional(),
  codec: z.string().max(40).nullable().optional(),
  error: z.string().nullable().optional(),
});

export type OptimizeResult = z.infer<typeof resultSchema>;

export interface ApplyOutcome {
  status: number;
  body: Record<string, unknown>;
}

const bestEffortDelete = async (key: string, what: string) => {
  await deleteObject(key).catch(() => console.warn(`[optimize] could not delete the ${what}; it is no longer referenced.`));
};

/** The worker's (already signature-checked) callback. Idempotent: a job is applied at most once. */
export async function applyOptimizeResult(payload: unknown): Promise<ApplyOutcome> {
  const parsed = resultSchema.safeParse(payload);
  if (!parsed.success) return { status: 400, body: { error: "invalid" } };
  const r = parsed.data;

  const [media] = await db
    .select()
    .from(mediaObjects)
    .where(and(eq(mediaObjects.id, r.mediaId.toLowerCase()), eq(mediaObjects.optimizeJobId, r.jobId.toLowerCase())))
    .limit(1);
  if (!media) return { status: 404, body: { error: "unknown_job" } };

  const outputKey = optimizedKeyOf(media);
  const applied = media.status !== "processing" || media.deletedAt !== null;
  if (applied) {
    // A late answer (the clip was given up on, or removed): its output is referenced by nothing.
    if (r.ok && outputKey && media.r2Key !== outputKey) await bestEffortDelete(outputKey, "late optimized copy");
    return { status: 200, body: { applied: false, reason: "already handled" } };
  }

  if (!r.ok || !r.sizeBytes || !outputKey) {
    await keepOriginal(media, (r.error ?? "Optimizing failed.").slice(0, 500), r.jobId.toLowerCase());
    return { status: 200, body: { applied: true, kept: "original" } };
  }

  const head = await headObject(outputKey);
  if (!head || head.size !== r.sizeBytes) {
    if (head) await bestEffortDelete(outputKey, "incomplete optimized copy");
    await keepOriginal(media, "The optimized copy did not arrive complete.", r.jobId.toLowerCase());
    return { status: 200, body: { applied: true, kept: "original" } };
  }

  const [row] = await db
    .update(mediaObjects)
    .set({ r2Key: outputKey, sizeBytes: r.sizeBytes, contentType: "video/mp4", status: "ready", optimizeError: null, updatedAt: new Date() })
    .where(and(eq(mediaObjects.id, media.id), eq(mediaObjects.optimizeJobId, r.jobId.toLowerCase()), eq(mediaObjects.status, "processing")))
    .returning();
  if (!row) return { status: 200, body: { applied: false, reason: "already handled" } };
  if (media.r2Key !== outputKey) await bestEffortDelete(media.r2Key, "original upload");
  return { status: 200, body: { applied: true, sizeBytes: row.sizeBytes, codec: r.codec ?? null } };
}

/** Clips processing for over 2 hours become ready as uploaded (run hourly by the connections cron). */
export async function recoverStuckOptimizing(now: Date = new Date()): Promise<number> {
  const rows = await db
    .update(mediaObjects)
    .set({ status: "ready", optimizeError: "Optimizing did not finish within 2 hours; the clip was kept as uploaded.", updatedAt: now })
    .where(and(eq(mediaObjects.status, "processing"), lt(mediaObjects.updatedAt, new Date(now.getTime() - STUCK_AFTER_MS))))
    .returning({ id: mediaObjects.id });
  return rows.length;
}
