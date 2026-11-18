/**
 * The editor worker's (already signature-checked) result for one job. Idempotent: only a job that
 * is still `running` is applied, once; any later or repeated callback is acknowledged and ignored.
 *
 * Nothing the worker says is taken on trust: every preview key must sit under that job's own
 * prefix and exist in storage, every clip an edit list names must be a raw clip of that thread,
 * and the media rows (workspace, thread, brand, size) are built here from the job and storage.
 */
import { and, desc, eq, inArray, isNotNull, isNull, lt } from "drizzle-orm";
import { addMessage } from "@/lib/conversations/store";
import { db, schema } from "@/lib/db";
import { isJobPreviewKey } from "@/lib/storage/keys";
import { headObject } from "@/lib/storage/r2";
import { getJob, type EditorJobRow } from "./jobs";
import { callbackSchema, type EditorCallback, type EditorManifest, type EditorUsage, type WorkerManifest } from "./manifest";
import { lastInbound, postEditorMessage, textMember, watchLink } from "./notify";

const { conversations, editorJobs, mediaObjects } = schema;

export const FAILED_MESSAGE = "Sorry, I couldn't finish this edit. Send your request again to retry.";
const DEFAULT_REPLY = "Here's your cut. Tell me what to change, or approve it.";

export interface CallbackOutcome {
  status: number;
  body: Record<string, unknown>;
}

class AlreadyHandled extends Error {}

const isUniqueViolation = (err: unknown) => {
  const e = err as { code?: string; cause?: { code?: string }; message?: string } | null;
  return e?.code === "23505" || e?.cause?.code === "23505" || /duplicate key|unique constraint/i.test(e?.message ?? "");
};

const usageFields = (usage: EditorUsage | null | undefined) => ({
  usage: usage ?? null,
  costUsd: usage ? usage.costUsd.toFixed(6) : null,
});

/** Fails a running job (with its usage, so the real cost is recorded either way) and says so in the thread. */
async function fail(job: EditorJobRow, error: string, usage: EditorUsage | null | undefined): Promise<boolean> {
  const now = new Date();
  const [row] = await db
    .update(editorJobs)
    .set({ status: "failed", error: error.slice(0, 2000), finishedAt: now, updatedAt: now, ...usageFields(usage) })
    .where(and(eq(editorJobs.id, job.id), eq(editorJobs.status, "running")))
    .returning();
  if (!row) return false;
  const [thread] = await db.select().from(conversations).where(eq(conversations.id, job.conversationId)).limit(1);
  if (thread) await postEditorMessage(thread, FAILED_MESSAGE);
  return true;
}

/**
 * Preview rows a revision may reuse: an unchanged cut can keep the previous job's preview, so its
 * key sits under that job's prefix. Key -> media id, from the thread's latest finished job before this one.
 */
async function reusablePreviews(job: EditorJobRow): Promise<Map<string, string>> {
  const [prev] = await db
    .select({ manifest: editorJobs.manifest })
    .from(editorJobs)
    .where(
      and(
        eq(editorJobs.conversationId, job.conversationId),
        eq(editorJobs.workspaceId, job.workspaceId),
        inArray(editorJobs.status, ["done", "approved"]),
        isNotNull(editorJobs.manifest),
        lt(editorJobs.createdAt, job.createdAt),
      ),
    )
    .orderBy(desc(editorJobs.createdAt))
    .limit(1);
  const cuts = prev?.manifest?.cuts ?? [];
  if (cuts.length === 0) return new Map();
  // Only rows that still exist as previews of this very thread.
  const rows = await db
    .select({ id: mediaObjects.id, r2Key: mediaObjects.r2Key })
    .from(mediaObjects)
    .where(
      and(
        inArray(mediaObjects.id, cuts.map((c) => c.preview.mediaId)),
        eq(mediaObjects.conversationId, job.conversationId),
        eq(mediaObjects.workspaceId, job.workspaceId),
        eq(mediaObjects.kind, "preview"),
        isNull(mediaObjects.deletedAt),
      ),
    );
  return new Map(rows.map((r) => [r.r2Key, r.id]));
}

interface Checked {
  /** Size of each new preview (under this job's prefix). */
  sizes: Map<string, number>;
  /** Media id of each preview reused from the previous job. */
  reused: Map<string, string>;
}

/** Why the manifest cannot be accepted, or what to store when every key and clip checks out. */
async function check(job: EditorJobRow, manifest: WorkerManifest): Promise<{ error: string } | Checked> {
  const keys = manifest.cuts.map((c) => c.preview.key);
  if (new Set(keys).size !== keys.length) return { error: "Two cuts share one preview." };
  if (new Set(manifest.cuts.map((c) => c.id)).size !== manifest.cuts.length) return { error: "Two cuts share one id." };
  const scope = { workspaceId: job.workspaceId, conversationId: job.conversationId, jobId: job.id };
  const previous = keys.some((k) => !isJobPreviewKey(k, scope)) ? await reusablePreviews(job) : new Map<string, string>();
  if (!keys.every((k) => isJobPreviewKey(k, scope) || previous.has(k))) return { error: "A preview is outside this job's storage." };

  const named = [...new Set(manifest.cuts.flatMap((c) => c.edl.map((e) => e.mediaId.toLowerCase())))];
  if (named.length > 0) {
    const found = await db
      .select({ id: mediaObjects.id })
      .from(mediaObjects)
      .where(
        and(
          inArray(mediaObjects.id, named),
          eq(mediaObjects.conversationId, job.conversationId),
          eq(mediaObjects.workspaceId, job.workspaceId),
          eq(mediaObjects.kind, "raw"),
          isNull(mediaObjects.deletedAt),
        ),
      );
    if (found.length !== named.length) return { error: "An edit names a clip that is not in this conversation." };
  }

  const sizes = new Map<string, number>();
  const reused = new Map<string, string>();
  for (const key of keys) {
    const head = await headObject(key); // a storage failure throws: the worker is told to try again
    if (!head || !Number.isFinite(head.size) || head.size <= 0) return { error: "A preview was not uploaded." };
    if (isJobPreviewKey(key, scope)) sizes.set(key, head.size);
    else reused.set(key, previous.get(key)!);
  }
  return { sizes, reused };
}

const replyText = (r: EditorCallback, hasCuts: boolean) => {
  const question = r.question?.trim();
  const reply = r.reply.trim() || (hasCuts || !question ? DEFAULT_REPLY : "");
  return [reply, question].filter(Boolean).join("\n\n");
};

export async function applyEditorResult(payload: unknown): Promise<CallbackOutcome> {
  const parsed = callbackSchema.safeParse(payload);
  if (!parsed.success) return { status: 400, body: { error: "invalid" } };
  const r = parsed.data;
  const job = await getJob(r.jobId.toLowerCase());
  if (!job) return { status: 404, body: { error: "unknown_job" } };
  if (job.status !== "running") return { status: 200, body: { applied: false, reason: "already handled" } };

  // A question with no cuts (a revision that needs an answer first) is a finished job with nothing to approve.
  const questionOnly = r.ok && !r.manifest && Boolean(r.question?.trim());
  if (!r.ok || (!r.manifest && !questionOnly)) {
    const applied = await fail(job, r.error?.trim() || "The editor returned no cuts.", r.usage);
    return { status: 200, body: { applied } };
  }

  const checked: Checked | { error: string } = r.manifest ? await check(job, r.manifest) : { sizes: new Map(), reused: new Map() };
  if ("error" in checked) {
    const applied = await fail(job, `Rejected result: ${checked.error}`, r.usage);
    return { status: 422, body: { error: "invalid_manifest", message: checked.error, applied } };
  }

  const [thread] = await db.select().from(conversations).where(and(eq(conversations.id, job.conversationId), eq(conversations.workspaceId, job.workspaceId))).limit(1);
  if (!thread) return { status: 404, body: { error: "unknown_job" } };
  const last = await lastInbound(thread.id);
  const body = replyText(r, Boolean(r.manifest));
  const newCuts = (r.manifest?.cuts ?? []).filter((c) => checked.sizes.has(c.preview.key));

  try {
    await db.transaction(async (tx) => {
      const rows = newCuts.length === 0 ? [] : await tx
        .insert(mediaObjects)
        .values(
          newCuts.map((c) => ({
            workspaceId: job.workspaceId,
            brandId: job.brandId,
            conversationId: job.conversationId,
            kind: "preview" as const,
            r2Key: c.preview.key,
            filename: c.preview.key.slice(c.preview.key.lastIndexOf("/") + 1),
            contentType: "video/mp4",
            sizeBytes: checked.sizes.get(c.preview.key)!,
            status: "ready" as const,
            uploadedBy: thread.startedBy,
          })),
        )
        .returning({ id: mediaObjects.id, r2Key: mediaObjects.r2Key });
      const idOf = new Map([...checked.reused, ...rows.map((m) => [m.r2Key, m.id] as const)]);
      const manifest: EditorManifest | null = r.manifest
        ? { cuts: r.manifest.cuts.map((c) => ({ ...c, preview: { key: c.preview.key, mediaId: idOf.get(c.preview.key)! } })) }
        : null;
      const now = new Date();
      const [done] = await tx
        .update(editorJobs)
        .set({ status: "done", manifest, error: null, finishedAt: now, updatedAt: now, ...usageFields(r.usage) })
        .where(and(eq(editorJobs.id, job.id), eq(editorJobs.status, "running")))
        .returning({ id: editorJobs.id });
      if (!done) throw new AlreadyHandled();
      await addMessage({ conversationId: thread.id, direction: "out", channel: last.channel, body, editorJobId: job.id }, tx);
    });
  } catch (err) {
    // A duplicate callback racing this one loses on the job's status or on the unique preview keys.
    if (err instanceof AlreadyHandled || isUniqueViolation(err)) return { status: 200, body: { applied: false, reason: "already handled" } };
    throw err;
  }

  if (last.channel === "sms" && r.manifest?.cuts.length) {
    // The cut is ready: what it is, then exactly what to do next.
    const text =
      `${thread.title ? `[${thread.title}] ` : ""}${body}\n\n` +
      `Watch, download or approve it: ${watchLink(thread.id)}\n` +
      `Or reply YES to approve, or tell me what to change.`;
    await textMember(last.authorUserId ?? thread.startedBy, text, thread.brandId);
  } else if (last.channel === "sms") {
    await textMember(last.authorUserId ?? thread.startedBy, `${thread.title ? `[${thread.title}] ` : ""}${body}`, thread.brandId);
  }
  return { status: 200, body: { applied: true, cuts: r.manifest?.cuts.length ?? 0 } };
}
