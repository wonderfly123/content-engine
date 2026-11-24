/**
 * A cut finished on the phone. The iPhone app rebuilds a cut from the camera originals (and from
 * whatever the person trimmed, reordered or removed in its editor), exports it, and sends that file
 * to take the place of the cloud editor's own preview. From then on the thread plays, approves,
 * schedules and posts the phone's version.
 *
 *   start    { jobId, cutKey, size }                   -> a one-hour link to PUT the file to
 *   complete { jobId, cutKey, size, seconds, shots }   -> checks the file, then points the cut at it
 *
 * Only the thread's newest finished cut, and only while it is not on the calendar: a scheduled or
 * posted video is never swapped underneath its post.
 */
import { and, eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import type { ConversationAccess } from "@/lib/conversations/access";
import { db, schema } from "@/lib/db";
import { latestFinishedJob } from "@/lib/editor/jobs";
import { edlEntrySchema, type EditorCut, type EditorManifest } from "@/lib/editor/manifest";
import { scheduledPostFor } from "@/lib/editor/schedule";
import { fail, jsonBody, threadClosed, withStorage } from "@/lib/media/http";
import { buildPreviewKey } from "@/lib/storage/keys";
import { headObject, presignPut } from "@/lib/storage/r2";

const { editorJobs, mediaObjects } = schema;

/** A finished vertical video of a few minutes at most. */
export const MAX_FINAL_BYTES = 500 * 1024 ** 2;
const UPLOAD_LINK_SECONDS = 60 * 60;

const startSchema = z.object({
  jobId: z.string().uuid(),
  cutKey: z.string().trim().min(1).max(200),
  size: z.number().int().positive().max(MAX_FINAL_BYTES),
});

const completeSchema = startSchema.extend({
  seconds: z.number().positive().max(600),
  shots: z.array(edlEntrySchema).min(1).max(500),
});

interface Target {
  job: typeof editorJobs.$inferSelect;
  cut: EditorCut;
  key: string;
}

/** The cut this request may replace and where its file goes, or the refusal. */
async function target(access: ConversationAccess, jobId: string, cutKey: string): Promise<Target | Response> {
  const thread = access.conversation;
  if (thread.status !== "open") return threadClosed();
  const latest = await latestFinishedJob(thread.id);
  if (!latest || latest.workspaceId !== access.workspaceId || latest.id !== jobId.toLowerCase()) {
    return fail(409, "not_current", "There is a newer cut in this chat. Open it and try again.");
  }
  const cut = (latest.manifest as EditorManifest | null)?.cuts.find((c) => c.id === cutKey);
  if (!cut) return fail(404, "unknown_cut", "That cut is not in this chat.");
  const post = await scheduledPostFor(latest.id, cut.id);
  if (post && post.status !== "rejected") {
    return fail(409, "already_scheduled", post.status === "published" ? "This one is already posted." : "This one is on the calendar. Unschedule it before changing the video.");
  }
  const key = buildPreviewKey({ workspaceId: latest.workspaceId, conversationId: latest.conversationId, jobId: latest.id, filename: `phone-${cut.id}.mp4` });
  return { job: latest, cut, key };
}

export async function startPhoneFinal(req: NextRequest, access: ConversationAccess): Promise<Response> {
  const parsed = startSchema.safeParse(await jsonBody(req));
  if (!parsed.success) return fail(400, "invalid", "Send the cut and the file's size (up to 500 MB).");
  const t = await target(access, parsed.data.jobId, parsed.data.cutKey);
  if (t instanceof Response) return t;
  return withStorage(async () => NextResponse.json({ uploadUrl: presignPut(t.key, UPLOAD_LINK_SECONDS) }));
}

export async function completePhoneFinal(req: NextRequest, access: ConversationAccess): Promise<Response> {
  const parsed = completeSchema.safeParse(await jsonBody(req));
  if (!parsed.success) return fail(400, "invalid", "Send the cut, the file's size, its length and its shots.");
  const { jobId, cutKey, size, seconds } = parsed.data;
  const t = await target(access, jobId, cutKey);
  if (t instanceof Response) return t;

  // Every shot must come from a clip of this thread: the edit list is replayed by the editor later.
  const clips = await db
    .select({ id: mediaObjects.id })
    .from(mediaObjects)
    .where(and(eq(mediaObjects.conversationId, access.conversation.id), eq(mediaObjects.workspaceId, access.workspaceId), eq(mediaObjects.kind, "raw")));
  const known = new Set(clips.map((c) => c.id));
  const shots = parsed.data.shots.map((s) => ({ ...s, mediaId: s.mediaId.toLowerCase() }));
  if (!shots.every((s) => known.has(s.mediaId))) return fail(400, "unknown_clip", "A shot uses a clip that is not in this chat.");

  return withStorage(async () => {
    const head = await headObject(t.key);
    if (!head || head.size !== size) return fail(422, "size_mismatch", "The video did not arrive complete. Send it again.");

    const mediaId = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: mediaObjects.id })
        .from(mediaObjects)
        .where(and(eq(mediaObjects.r2Key, t.key), eq(mediaObjects.workspaceId, access.workspaceId)))
        .limit(1);
      let id = existing?.id;
      if (id) {
        await tx.update(mediaObjects).set({ sizeBytes: size, status: "ready", deletedAt: null, updatedAt: new Date() }).where(eq(mediaObjects.id, id));
      } else {
        const [row] = await tx
          .insert(mediaObjects)
          .values({
            workspaceId: t.job.workspaceId,
            brandId: t.job.brandId,
            conversationId: t.job.conversationId,
            kind: "preview",
            r2Key: t.key,
            filename: t.key.slice(t.key.lastIndexOf("/") + 1),
            contentType: "video/mp4",
            sizeBytes: size,
            status: "ready",
            uploadedBy: access.user.userId,
          })
          .returning({ id: mediaObjects.id });
        id = row.id;
      }
      // Re-read inside the transaction, so a result landing at the same moment is not overwritten.
      const [fresh] = await tx.select({ manifest: editorJobs.manifest }).from(editorJobs).where(eq(editorJobs.id, t.job.id)).limit(1);
      const manifest = fresh?.manifest as EditorManifest | null;
      if (!manifest) throw new Error("The cut is gone.");
      const next: EditorManifest = {
        ...manifest,
        cuts: manifest.cuts.map((c) => (c.id === t.cut.id ? { ...c, preview: { key: t.key, mediaId: id! }, edl: shots, seconds } : c)),
      };
      await tx.update(editorJobs).set({ manifest: next, updatedAt: new Date() }).where(eq(editorJobs.id, t.job.id));
      return id!;
    });
    return NextResponse.json({ previewId: mediaId, seconds });
  });
}
