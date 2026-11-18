/**
 * Every uploaded clip lands in the brand's Assets library, described and tagged by AI:
 *
 *   clip ready (lib/media/optimize.ts) -> addClipToLibrary: an `assets` row (r2://, tagged with its project)
 *   requestDescribe -> POST MODAL_FRAMES_URL { jobId, assetId, sourceUrl, sheetUrl, thumbUrl, callbackUrl }
 *   worker (workers/optimize/app.py `frames`) -> 6 frames tiled into a sheet + a thumbnail -> PUT -> POST /api/media/frames
 *   applyFramesResult -> Claude looks at the sheet -> title, one-sentence description, tags
 *
 * Images skip the worker: Claude looks at the image itself. Tags are what the clip shows (activity,
 * shot type, setting and people) plus the project it came from; never words from the file name.
 * Like naming, it uses the workspace's own Anthropic key; without one the clip is filed untagged.
 * Nothing here ever blocks an upload or an edit: every failure is recorded on the row and logged.
 */
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { appUrl } from "@/lib/conversations/texting";
import { getCredential } from "@/lib/credentials/store";
import { db, schema } from "@/lib/db";
import { conversations } from "@/lib/db/schema-conversations";
import { presignGet, presignPut, R2_URI_PREFIX } from "@/lib/storage/r2";
import type { MediaRow } from "./access";
import { optimizeSecret } from "./worker-signature";

const { assets, brands } = schema;

export const DESCRIBE_MODEL = "claude-opus-5-5";
export const FRAMES_CALLBACK_PATH = "/api/media/frames";
const LINK_SECONDS = 60 * 60;
const REQUEST_TIMEOUT_MS = 20_000;
const CLAUDE_TIMEOUT_MS = 60_000;
const MAX_INT = 2_147_483_647;

type AssetRow = typeof assets.$inferSelect;

/** A link the worker or Claude can fetch: r2://<key> becomes a presigned GET; anything else as is. */
const fetchable = (storageUrl: string, seconds: number) => (storageUrl.startsWith(R2_URI_PREFIX) ? presignGet(storageUrl.slice(R2_URI_PREFIX.length), seconds) : storageUrl);

/** Where an asset's contact sheet and thumbnail live: ws/<workspace>/frames/<asset>-sheet.jpg. */
export const frameKey = (workspaceId: string, assetId: string, which: "sheet" | "thumb") => `ws/${workspaceId.toLowerCase()}/frames/${assetId.toLowerCase()}-${which}.jpg`;

/**
 * Files a ready clip in its brand's library (once: the clip's id is unique there) and starts its
 * description. Clips without a brand, or not raw footage, are left out. Never throws.
 */
export async function addClipToLibrary(m: MediaRow, origin?: string | null): Promise<string | null> {
  try {
    if (!m.brandId || m.kind !== "raw" || m.status !== "ready" || m.deletedAt) return null;
    const [thread] = m.conversationId
      ? await db.select({ title: conversations.title }).from(conversations).where(eq(conversations.id, m.conversationId)).limit(1)
      : [];
    const project = thread?.title?.trim() || null;
    const [row] = await db
      .insert(assets)
      .values({
        brandId: m.brandId,
        kind: "video",
        label: project ?? m.filename,
        tags: project ? [project] : [],
        storageUrl: `${R2_URI_PREFIX}${m.r2Key}`,
        mimeType: m.contentType,
        sizeBytes: m.sizeBytes <= MAX_INT ? m.sizeBytes : null,
        source: "uploaded",
        mediaObjectId: m.id,
      })
      .onConflictDoNothing()
      .returning({ id: assets.id });
    if (!row) return null;
    await requestDescribe(row.id, origin);
    return row.id;
  } catch (err) {
    console.warn(`[describe] could not file clip ${m.id} in the library: ${(err as Error).message}`);
    return null;
  }
}

function framesConfig(): { url: string; secret: string } | null {
  const url = process.env.MODAL_FRAMES_URL?.trim();
  const secret = optimizeSecret();
  return url && secret ? { url, secret } : null;
}

async function setStatus(id: string, status: "pending" | "done" | "failed", error: string | null, jobId?: string | null) {
  await db
    .update(assets)
    .set({ describeStatus: status, describeError: error?.slice(0, 500) ?? null, ...(jobId !== undefined ? { describeJobId: jobId } : {}) })
    .where(eq(assets.id, id));
}

/** Starts (or restarts) an asset's description: frames from the worker for a video, the image itself otherwise. */
export async function requestDescribe(assetId: string, origin?: string | null): Promise<void> {
  const [row] = await db
    .select({ asset: assets, workspaceId: brands.workspaceId })
    .from(assets)
    .innerJoin(brands, eq(brands.id, assets.brandId))
    .where(eq(assets.id, assetId))
    .limit(1);
  if (!row) return;
  const { asset, workspaceId } = row;

  if (asset.kind === "image" || asset.kind === "graphic") {
    await setStatus(asset.id, "pending", null, null);
    await describeAndSave(asset, workspaceId, fetchable(asset.storageUrl, LINK_SECONDS));
    return;
  }
  if (asset.kind !== "video") return;

  const config = framesConfig();
  if (!config) {
    await setStatus(asset.id, "failed", "Clip descriptions are not switched on (MODAL_FRAMES_URL).", null);
    return;
  }
  const jobId = randomUUID();
  await setStatus(asset.id, "pending", null, jobId);
  try {
    const res = await fetch(config.url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${config.secret}` },
      body: JSON.stringify({
        jobId,
        assetId: asset.id,
        sourceUrl: fetchable(asset.storageUrl, 2 * LINK_SECONDS),
        sheetUrl: presignPut(frameKey(workspaceId, asset.id, "sheet"), 2 * LINK_SECONDS),
        thumbUrl: presignPut(frameKey(workspaceId, asset.id, "thumb"), 2 * LINK_SECONDS),
        callbackUrl: `${appUrl(origin)}${FRAMES_CALLBACK_PATH}`,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) await setStatus(asset.id, "failed", `The frames worker refused the job (HTTP ${res.status}).`);
  } catch (err) {
    await setStatus(asset.id, "failed", `The frames worker could not be reached (${(err as Error).name}).`);
  }
}

const framesResultSchema = z.object({
  jobId: z.string().uuid(),
  assetId: z.string().uuid(),
  ok: z.boolean(),
  durationSec: z.number().nonnegative().nullable().optional(),
  error: z.string().nullable().optional(),
});

/** The worker's (already signature-checked) callback. Applied once: the job id must still be current. */
export async function applyFramesResult(payload: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const parsed = framesResultSchema.safeParse(payload);
  if (!parsed.success) return { status: 400, body: { error: "invalid" } };
  const r = parsed.data;
  const [row] = await db
    .select({ asset: assets, workspaceId: brands.workspaceId })
    .from(assets)
    .innerJoin(brands, eq(brands.id, assets.brandId))
    .where(and(eq(assets.id, r.assetId.toLowerCase()), eq(assets.describeJobId, r.jobId.toLowerCase())))
    .limit(1);
  if (!row) return { status: 404, body: { error: "unknown_job" } };
  if (row.asset.describeStatus !== "pending") return { status: 200, body: { applied: false, reason: "already handled" } };
  if (!r.ok) {
    await setStatus(row.asset.id, "failed", r.error ?? "Taking frames failed.");
    return { status: 200, body: { applied: true, described: false } };
  }
  await db
    .update(assets)
    .set({
      thumbnailUrl: `${R2_URI_PREFIX}${frameKey(row.workspaceId, row.asset.id, "thumb")}`,
      ...(r.durationSec ? { durationSec: Math.round(r.durationSec) } : {}),
    })
    .where(eq(assets.id, row.asset.id));
  const described = await describeAndSave(row.asset, row.workspaceId, presignGet(frameKey(row.workspaceId, row.asset.id, "sheet"), LINK_SECONDS));
  return { status: 200, body: { applied: true, described } };
}

// ---- The AI part ----------------------------------------------------------------------------------

export interface ClipDescription {
  title: string;
  description: string;
  activity: string[];
  shot: string[];
  setting: string[];
}

const DESCRIPTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "description", "activity", "shot", "setting"],
  properties: {
    title: { type: "string", description: "2 to 6 words naming what the clip shows, Title Case" },
    description: { type: "string", description: "One plain sentence, under 160 characters, saying what happens in the clip" },
    activity: { type: "array", items: { type: "string" }, description: "1 to 4 short tags for what is happening or shown, e.g. truck loading, crowd, finished stand, pouring cider, build" },
    shot: { type: "array", items: { type: "string" }, description: "1 to 2 of: wide, close-up, pov, walkaround, timelapse, talking to camera, overhead, detail" },
    setting: { type: "array", items: { type: "string" }, description: "1 to 3 of: indoor, outdoor, day, night, no people, one person, small group, crowd" },
  },
} as const;

/** Lowercase, trimmed, deduped tags, the project first (kept as written). */
export function tagsFor(project: string | null, d: ClipDescription): string[] {
  const out: string[] = project ? [project] : [];
  for (const t of [...d.activity, ...d.shot, ...d.setting]) {
    const tag = t.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 40);
    if (tag && !out.some((o) => o.toLowerCase() === tag)) out.push(tag);
  }
  return out.slice(0, 12);
}

/** Asks Claude about one image (a contact sheet of six frames, or a photo). Null when it cannot. */
export async function describeImage(
  input: { workspaceId: string; imageUrl: string; sheet: boolean; project: string | null; brandName: string | null },
  deps: { fetchImpl?: typeof fetch; key?: string | null } = {},
): Promise<ClipDescription | { error: string }> {
  const key = deps.key !== undefined ? deps.key : await getCredential(input.workspaceId, "anthropic").catch(() => null);
  if (!key) return { error: "No Anthropic key is connected for this workspace." };
  const what = input.sheet
    ? "These are six frames from one short phone video, in order left to right, top to bottom."
    : "This is one photo.";
  try {
    const res = await (deps.fetchImpl ?? fetch)("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        // On a safety decline, the API re-runs the request on a fallback model by itself.
        "anthropic-beta": "server-side-fallback-2026-07-01",
        "content-type": "application/json",
      },
      signal: AbortSignal.timeout(CLAUDE_TIMEOUT_MS),
      body: JSON.stringify({
        model: DESCRIBE_MODEL,
        max_tokens: 2000,
        fallbacks: "default",
        output_config: { effort: "low", format: { type: "json_schema", schema: DESCRIPTION_SCHEMA } },
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "url", url: input.imageUrl } },
              {
                type: "text",
                text:
                  `${what} It is footage for social media${input.brandName ? ` for ${input.brandName}` : ""}` +
                  `${input.project ? `, from a project called "${input.project}"` : ""}.\n` +
                  "Describe what it shows so the footage can be found later in a library. Only say what you can see; never guess names, places or brands you cannot read in the picture.",
              },
            ],
          },
        ],
      }),
    });
    if (!res.ok) return { error: `Claude answered HTTP ${res.status}.` };
    const json = (await res.json()) as { stop_reason?: string; content?: Array<{ type: string; text?: string }> };
    if (json.stop_reason === "refusal") return { error: "Claude declined to describe this clip." };
    const text = json.content?.find((c) => c.type === "text")?.text ?? "";
    const d = JSON.parse(text) as ClipDescription;
    const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
    const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
    return { title: str(d.title, 80), description: str(d.description, 300), activity: list(d.activity), shot: list(d.shot), setting: list(d.setting) };
  } catch (err) {
    return { error: `Describing failed (${(err as Error).name}).` };
  }
}

async function describeAndSave(asset: AssetRow, workspaceId: string, imageUrl: string): Promise<boolean> {
  const [brand] = await db.select({ name: brands.name }).from(brands).where(eq(brands.id, asset.brandId)).limit(1);
  const [thread] = asset.mediaObjectId
    ? await db
        .select({ title: conversations.title })
        .from(schema.mediaObjects)
        .innerJoin(conversations, eq(conversations.id, schema.mediaObjects.conversationId))
        .where(eq(schema.mediaObjects.id, asset.mediaObjectId))
        .limit(1)
    : [];
  const project = thread?.title?.trim() || null;
  const d = await describeImage({ workspaceId, imageUrl, sheet: asset.kind === "video", project, brandName: brand?.name ?? null });
  if ("error" in d) {
    await setStatus(asset.id, "failed", d.error);
    return false;
  }
  // Tags the person typed themselves stay; the AI's are added alongside.
  const own = asset.tags.filter((t) => t !== project);
  const tags = [...tagsFor(project, d), ...own.filter((t) => !tagsFor(project, d).includes(t.toLowerCase()))].slice(0, 20);
  await db
    .update(assets)
    .set({ label: d.title || asset.label, description: d.description || null, tags, describeStatus: "done", describeError: null })
    .where(eq(assets.id, asset.id));
  return true;
}
