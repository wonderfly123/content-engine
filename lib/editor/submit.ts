/**
 * Starting an editor job (the seam in lib/conversations/editor.ts calls this):
 *
 *   startEditorJob -> POST MODAL_EDITOR_URL (Bearer MODAL_EDITOR_SECRET) { jobId, kind, clips, ... } -> 202
 *   worker -> POST /api/editor/uploads?job=<id> for upload links -> PUTs its previews
 *   worker -> POST /api/editor/callback (signed) -> lib/editor/callback.ts
 *
 * The worker gets presigned links (2 hours) for the thread's ready clips, the workspace's own
 * Anthropic key (decrypted here, at send time only) and nothing else: no database access, and
 * every storage key it writes to is derived here from the job, never taken from it.
 */
import { isClipsMessage } from "@/lib/media/rules";
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { EDITOR_NOT_CONNECTED, listBrands } from "@/lib/conversations/router";
import { activeBrands } from "@/lib/conversations/store";
import { appUrl } from "@/lib/conversations/texting";
import { getCredential } from "@/lib/credentials/store";
import { db, schema } from "@/lib/db";
import type { EditorJobKind } from "@/lib/db/enums";
import { tracksForWorkspace } from "@/lib/music/library";
import { presignGet } from "@/lib/storage/r2";
import { isWorkspaceKey } from "@/lib/storage/keys";
import { brandVoice } from "./brand-voice";
import { failJob, hasAnyJob, latestFinishedJob, activeJob, recoverStuckEditorJobs } from "./jobs";
import type { EditorManifest } from "./manifest";
import { currentSkillFiles } from "./skill-store";
import { editorSecret } from "./worker-auth";

const { conversations, conversationMessages, mediaObjects, brands, editorJobs } = schema;

export const EDITOR_MODEL = "claude-opus-5-5";
/** How long the worker's clip links stay valid. */
export const EDITOR_LINK_SECONDS = 2 * 60 * 60;
export const CALLBACK_PATH = "/api/editor/callback";
export const UPLOADS_PATH = "/api/editor/uploads";
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_REQUEST_CHARS = 8000;

export const REPLIES = {
  needClips: "Send or upload your clips first, then tell me what you want.",
  clipsPreparing: "Your clips are still being prepared. Tell me again in a minute.",
  busy: "Still working on the last edit. I'll post it here as soon as it's ready.",
  noKey: "Add your Anthropic key in Settings > Connections first, then send that again.",
  notConnected: EDITOR_NOT_CONNECTED,
  storageOff: "Clip storage isn't set up yet, so the editor can't reach your clips.",
  refused: "The editor couldn't take this right now. Try again in a minute.",
  firstCut: "On it… I'll post the first cut here when it's ready.",
  revision: "On it… I'll post the new version here when it's ready.",
} as const;

export interface EditorHandoff {
  queued: boolean;
  reason?: string;
  /** What to say back in the thread; none means the router's own reply stands. */
  reply?: string | null;
  /** The job that was sent, when queued. */
  jobId?: string;
}

export interface EditorJobRequest {
  jobId: string;
  kind: EditorJobKind;
  videoKind: "reel" | "story";
  brand: { name: string; voice: string };
  instructions: string;
  request: string;
  clips: Array<{ mediaId: string; filename: string; url: string }>;
  previous: null | { manifest: EditorManifest };
  uploads: { url: string };
  anthropicApiKey: string;
  model: string;
  callbackUrl: string;
  /**
   * The current version of every editable skill file (Admin > Editor skill), written over the
   * worker's baked copy for this job. Left out if they can't be read; the worker then uses its own.
   */
  skillFiles?: Record<string, string>;
  /**
   * The music the editor may lay under a cut: the platform library's active tracks plus the
   * workspace's own (lib/music/library.ts), with presigned links. Empty when there are none or
   * they can't be read; the cuts are then silent.
   */
  music: EditorJobTrack[];
}

export interface EditorJobTrack {
  id: string;
  title: string;
  seconds: number;
  bpm: number | null;
  firstBeat: number | null;
  beatStrength: number | null;
  loudestFrom: number | null;
  url: string;
}

async function musicForJob(workspaceId: string, jobId: string): Promise<EditorJobTrack[]> {
  try {
    // Inside the worker's limits (workers/editor/contract.py valid_tracks), or one odd row would refuse the whole job.
    const within = (v: number | null, max: number) => (v !== null && Number.isFinite(v) && v >= 0 && v <= max ? v : null);
    const rows = await tracksForWorkspace(workspaceId);
    return rows
      .filter((t) => Number.isFinite(t.seconds) && t.seconds > 0 && t.seconds <= 3600 && t.title.trim())
      .map((t) => ({
        id: t.id,
        title: t.title.trim().slice(0, 200),
        seconds: t.seconds,
        bpm: within(t.bpm, 400),
        firstBeat: within(t.firstBeat, 3600),
        beatStrength: within(t.beatStrength, 10_000),
        loudestFrom: within(t.loudestFrom, 3600),
        url: presignGet(t.r2Key, EDITOR_LINK_SECONDS),
      }));
  } catch {
    console.warn(`[editor] the music library could not be read for job ${jobId}; the cuts will be silent.`);
    return [];
  }
}

async function skillFilesForJob(jobId: string): Promise<Record<string, string> | undefined> {
  try {
    return await currentSkillFiles();
  } catch {
    console.warn(`[editor] the skill files could not be read for job ${jobId}; the worker uses its baked copy.`);
    return undefined;
  }
}

export function editorConfig(): { url: string; secret: string } | null {
  const url = process.env.MODAL_EDITOR_URL?.trim();
  const secret = editorSecret();
  return url && secret ? { url, secret } : null;
}

const isUniqueViolation = (err: unknown) => {
  const e = err as { code?: string; cause?: { code?: string }; message?: string } | null;
  return e?.code === "23505" || e?.cause?.code === "23505" || /duplicate key|unique constraint/i.test(e?.message ?? "");
};

/** The person's recent messages in the thread, oldest first: what a first cut started by new clips is for. */
async function recentRequests(conversationId: string): Promise<string> {
  const rows = await db
    .select({ body: conversationMessages.body })
    .from(conversationMessages)
    .where(and(eq(conversationMessages.conversationId, conversationId), eq(conversationMessages.direction, "in")))
    .orderBy(desc(conversationMessages.createdAt))
    .limit(10);
  return rows
    .reverse()
    .map((r) => r.body)
    .join("\n");
}

export async function startEditorJob(threadId: string, messageId: string, origin?: string | null): Promise<EditorHandoff> {
  const [thread] = await db.select().from(conversations).where(eq(conversations.id, threadId)).limit(1);
  if (!thread || thread.status !== "open") return { queued: false, reason: "no open thread" };
  // A campaign makes its videos from the plan (lib/campaigns/run.ts), never from a loose message.
  if (thread.kind === "campaign") return { queued: false, reason: "campaign thread" };
  // The router asks "Reel or story?" / "Which brand?" first.
  if (!thread.kind) return { queued: false, reason: "kind not known yet" };
  if (!thread.brandId) {
    const names = (await activeBrands(thread.workspaceId)).map((b) => b.name);
    return { queued: false, reason: "brand not known yet", reply: `Tell me which brand this is for first: ${listBrands(names)}.` };
  }
  const [trigger] = await db
    .select()
    .from(conversationMessages)
    .where(and(eq(conversationMessages.id, messageId), eq(conversationMessages.conversationId, thread.id)))
    .limit(1);
  if (!trigger) return { queued: false, reason: "unknown message" };
  // New clips (the person's "Added N clips" message) start a first cut only; after that, the person asks.
  const byClips = isClipsMessage(trigger.body);
  if (byClips && (await hasAnyJob(thread.id))) return { queued: false, reason: "clips added to a thread that already has cuts" };

  const clipRows = await db
    .select()
    .from(mediaObjects)
    .where(and(eq(mediaObjects.conversationId, thread.id), eq(mediaObjects.workspaceId, thread.workspaceId), eq(mediaObjects.kind, "raw"), isNull(mediaObjects.deletedAt)))
    .orderBy(asc(mediaObjects.createdAt));
  const ready = clipRows.filter((m) => m.status === "ready" && isWorkspaceKey(m.r2Key, thread.workspaceId));
  if (ready.length === 0) {
    const preparing = clipRows.some((m) => m.status === "processing");
    if (byClips) return { queued: false, reason: "clips still processing" };
    return { queued: false, reason: "no clips", reply: preparing ? REPLIES.clipsPreparing : REPLIES.needClips };
  }

  await recoverStuckEditorJobs(new Date(), thread.id);
  if (await activeJob(thread.id)) return { queued: false, reason: "busy", reply: REPLIES.busy };

  const [brand] = await db
    .select()
    .from(brands)
    .where(and(eq(brands.id, thread.brandId), eq(brands.workspaceId, thread.workspaceId)))
    .limit(1);
  if (!brand) return { queued: false, reason: "brand not found" };
  const previous = await latestFinishedJob(thread.id);
  const kind: EditorJobKind = previous?.manifest ? "revision" : "first_cut";
  const request = (byClips ? await recentRequests(thread.id) : trigger.body).slice(0, MAX_REQUEST_CHARS);
  const handoff = await dispatchEditorJob({
    thread,
    brand,
    kind,
    videoKind: thread.kind === "story" ? "story" : "reel",
    request,
    instructions: "",
    clips: ready,
    previous: previous?.manifest ?? null,
    triggerMessageId: trigger.id,
    origin,
  });
  return handoff.queued ? { queued: true, reply: kind === "revision" ? REPLIES.revision : REPLIES.firstCut } : handoff;
}

type BrandRow = typeof brands.$inferSelect;
type MediaRow = typeof mediaObjects.$inferSelect;

export interface DispatchInput {
  thread: typeof conversations.$inferSelect;
  brand: BrandRow;
  kind: EditorJobKind;
  videoKind: "reel" | "story";
  request: string;
  instructions: string;
  /** Ready raw clips, already checked to belong to the thread's workspace (and brand, for library clips). */
  clips: MediaRow[];
  previous: EditorManifest | null;
  triggerMessageId: string | null;
  /** In a campaign chat: the plan item this job makes. */
  campaignItemId?: string | null;
  origin?: string | null;
}

/**
 * Records the job (one in flight per thread), then sends it to the worker with presigned links to
 * the given clips and the workspace's own key. The caller has checked the thread, brand and clips.
 */
export async function dispatchEditorJob(input: DispatchInput): Promise<EditorHandoff> {
  const { thread, brand, kind, request } = input;
  const apiKey = await getCredential(thread.workspaceId, "anthropic");
  if (!apiKey) return { queued: false, reason: "no anthropic key", reply: REPLIES.noKey };
  const clipRows = input.clips.filter((m) => isWorkspaceKey(m.r2Key, thread.workspaceId));

  const jobId = randomUUID();
  try {
    await db.insert(editorJobs).values({
      id: jobId,
      workspaceId: thread.workspaceId,
      conversationId: thread.id,
      brandId: brand.id,
      kind,
      status: "queued",
      triggerMessageId: input.triggerMessageId,
      request,
      model: EDITOR_MODEL,
      campaignItemId: input.campaignItemId ?? null,
      clipIds: clipRows.map((m) => m.id),
    });
  } catch (err) {
    if (isUniqueViolation(err)) return { queued: false, reason: "busy", reply: REPLIES.busy };
    throw err;
  }

  const config = editorConfig();
  if (!config) {
    console.info(`[editor] MODAL_EDITOR_URL / MODAL_EDITOR_SECRET not set: job ${jobId} not sent.`);
    await failJob(jobId, "The editor worker is not configured.");
    return { queued: false, reason: "not configured", reply: REPLIES.notConnected };
  }

  let clips: EditorJobRequest["clips"];
  try {
    clips = clipRows.map((m) => ({ mediaId: m.id, filename: m.filename, url: presignGet(m.r2Key, EDITOR_LINK_SECONDS) }));
  } catch {
    await failJob(jobId, "Storage is not configured.");
    return { queued: false, reason: "storage not configured", reply: REPLIES.storageOff };
  }

  // Running before the worker hears of it, so its first upload request is never refused.
  const now = new Date();
  await db.update(editorJobs).set({ status: "running", startedAt: now, updatedAt: now }).where(and(eq(editorJobs.id, jobId), eq(editorJobs.status, "queued")));

  const base = appUrl(input.origin);
  const job: EditorJobRequest = {
    jobId,
    kind,
    videoKind: input.videoKind,
    brand: { name: brand.name, voice: brandVoice(brand) },
    instructions: input.instructions,
    request,
    clips,
    previous: input.previous ? { manifest: input.previous } : null,
    uploads: { url: `${base}${UPLOADS_PATH}?job=${jobId}` },
    anthropicApiKey: apiKey,
    model: EDITOR_MODEL,
    callbackUrl: `${base}${CALLBACK_PATH}`,
    music: await musicForJob(thread.workspaceId, jobId),
  };
  const skillFiles = await skillFilesForJob(jobId);
  if (skillFiles) job.skillFiles = skillFiles;

  try {
    const res = await fetch(config.url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${config.secret}` },
      body: JSON.stringify(job),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn(`[editor] the worker refused job ${jobId} (HTTP ${res.status}).`);
      await failJob(jobId, `The editor worker refused the job (HTTP ${res.status}).`, ["running"]);
      return { queued: false, reason: "refused", reply: REPLIES.refused };
    }
  } catch {
    console.warn(`[editor] the worker could not be reached for job ${jobId}.`);
    await failJob(jobId, "The editor worker could not be reached.", ["running"]);
    return { queued: false, reason: "unreachable", reply: REPLIES.refused };
  }
  return { queued: true, jobId };
}
