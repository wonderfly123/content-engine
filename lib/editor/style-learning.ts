/**
 * Learning from feedback: when a cut is approved or the person asks for changes, Claude may propose
 * ONE small tweak to one section of the brand's editor style, with a one-line reason, or nothing.
 * The tweak waits in Settings > Editor style for Accept (a new version of that section) or Dismiss.
 *
 * Never blocks the approval or the edit: `learnInBackground` runs after the response, and every
 * failure is logged and dropped. It uses the workspace's own Anthropic key, like clip descriptions.
 * Rate limits: one call per job and outcome, at most one pending suggestion per section, and at
 * most MAX_PENDING_PER_BRAND pending in all.
 */
import { after } from "next/server";
import { and, count, desc, eq } from "drizzle-orm";
import { addMessage } from "@/lib/conversations/store";
import { getCredential } from "@/lib/credentials/store";
import { db, schema } from "@/lib/db";
import type { EditorManifest } from "./manifest";
import { currentStyle, saveStyleSection, StyleError, type BrandRef } from "./style-store";
import { MAX_NOTES_CHARS, SECTIONS, STYLE_SECTION_IDS, isStyleSection, sectionDef, type EditorStyle, type StyleSectionId } from "./style-schema";

const { editorStyleSuggestions: suggestions, editorJobs, conversationMessages, brands } = schema;

export const LEARN_MODEL = "claude-opus-5-5";
export const MAX_PENDING_PER_BRAND = 3;
const CLAUDE_TIMEOUT_MS = 60_000;
const MAX_CHANGE_CHARS = 160;
const MAX_REASON_CHARS = 200;
/** The message when a suggestion is not this brand's, or already decided (the route answers 404). */
export const SUGGESTION_GONE = "That suggestion is gone.";

export type FeedbackSource = "approved" | "changes";
type SuggestionRow = typeof suggestions.$inferSelect;

export interface StyleSuggestionView {
  id: string;
  section: StyleSectionId;
  sectionTitle: string;
  change: string;
  reason: string;
  source: FeedbackSource;
  createdAt: string;
}

export const suggestionView = (r: SuggestionRow): StyleSuggestionView => ({
  id: r.id,
  section: r.section as StyleSectionId,
  sectionTitle: isStyleSection(r.section) ? sectionDef(r.section).title : r.section,
  change: r.change,
  reason: r.reason,
  source: r.source === "changes" ? "changes" : "approved",
  createdAt: r.createdAt.toISOString(),
});

const SUGGESTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["suggest", "section", "change", "reason"],
  properties: {
    suggest: { type: "boolean", description: "false when the feedback teaches nothing lasting about this brand's taste" },
    section: { type: "string", enum: [...STYLE_SECTION_IDS] },
    change: { type: "string", description: "One short instruction to add to that section, under 120 characters, plain words, e.g. 'Keep on-screen text under 6 words'" },
    reason: { type: "string", description: "One plain line on why, citing the feedback, under 150 characters" },
  },
} as const;

interface Proposal {
  section: StyleSectionId;
  change: string;
  reason: string;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function describeStyle(style: EditorStyle): string {
  return SECTIONS.map((def) => {
    const v = style[def.id];
    const picks = def.id === "footage" ? { types: (v.picks.types as Array<{ name: string }>).map((t) => t.name) } : v.picks;
    return `[${def.id}] ${def.title}\npicks: ${JSON.stringify(picks)}\nnotes: ${clip(v.notes.replace(/\s+/g, " "), 500)}`;
  }).join("\n\n");
}

function describeCuts(manifest: EditorManifest | null): string {
  const cuts = (manifest as { cuts?: Array<{ title?: string; seconds?: number; hookOptions?: string[]; caption?: string }> } | null)?.cuts ?? [];
  if (!cuts.length) return "(no cuts)";
  return cuts
    .slice(0, 4)
    .map((c) => `- ${c.title ?? "cut"} (${c.seconds ?? "?"}s). Hooks: ${(c.hookOptions ?? []).slice(0, 3).join(" | ")}. Caption: ${clip(c.caption ?? "", 200)}`)
    .join("\n");
}

/** Asks Claude for at most one tweak. Null when it suggests nothing or cannot answer. */
export async function askForTweak(
  input: { key: string; brandName: string; source: FeedbackSource; style: EditorStyle; messages: string[]; cuts: string; request: string | null; skip: StyleSectionId[] },
  fetchImpl: typeof fetch = fetch,
): Promise<Proposal | null> {
  const what =
    input.source === "approved"
      ? "The person just APPROVED the editor's latest cut."
      : `The person just ASKED FOR CHANGES to the editor's latest cut: "${clip(input.request ?? "", 1500)}"`;
  const text =
    `You help a video editor learn one brand's taste. Brand: ${input.brandName}.\n${what}\n\n` +
    `The cut(s) they were looking at:\n${input.cuts}\n\n` +
    `Their recent messages in this chat, oldest first:\n${input.messages.map((m) => `- ${clip(m, 300)}`).join("\n") || "(none)"}\n\n` +
    `The brand's current editor style, by section:\n${describeStyle(input.style)}\n\n` +
    "Propose at most ONE small, lasting tweak to ONE section, only when the feedback clearly shows a preference that will " +
    "hold for future videos (not a one-off fix for this video, and not something the style already says). Most of the time, suggest nothing." +
    (input.skip.length ? ` Do not pick these sections, they already have a pending suggestion: ${input.skip.join(", ")}.` : "");
  try {
    const res = await fetchImpl("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": input.key,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "server-side-fallback-2026-07-01",
        "content-type": "application/json",
      },
      signal: AbortSignal.timeout(CLAUDE_TIMEOUT_MS),
      body: JSON.stringify({
        model: LEARN_MODEL,
        max_tokens: 1500,
        fallbacks: "default",
        output_config: { effort: "low", format: { type: "json_schema", schema: SUGGESTION_SCHEMA } },
        messages: [{ role: "user", content: [{ type: "text", text }] }],
      }),
    });
    if (!res.ok) {
      console.warn(`[style-learning] Claude answered HTTP ${res.status}.`);
      return null;
    }
    const json = (await res.json()) as { stop_reason?: string; content?: Array<{ type: string; text?: string }> };
    if (json.stop_reason === "refusal") return null;
    const out = JSON.parse(json.content?.find((c) => c.type === "text")?.text ?? "{}") as { suggest?: unknown; section?: unknown; change?: unknown; reason?: unknown };
    const change = typeof out.change === "string" ? out.change.replace(/\s+/g, " ").trim() : "";
    if (out.suggest !== true || !isStyleSection(out.section) || !change || input.skip.includes(out.section)) return null;
    const reason = typeof out.reason === "string" ? out.reason.replace(/\s+/g, " ").trim() : "";
    return { section: out.section, change: clip(change, MAX_CHANGE_CHARS), reason: clip(reason, MAX_REASON_CHARS) };
  } catch (err) {
    console.warn(`[style-learning] the call failed (${(err as Error).name}).`);
    return null;
  }
}

export interface FeedbackInput {
  jobId: string;
  source: FeedbackSource;
  /** What the person asked for (change requests). */
  request?: string | null;
  /** The cuts they were looking at, when they are not on `jobId` (a revision's job has none yet). */
  manifest?: EditorManifest | null;
}

/**
 * Looks at one approval or change request and may store one pending suggestion (and a short note
 * in the chat). Returns the stored row, or null. Throws only on database errors.
 */
export async function proposeStyleTweak(
  input: FeedbackInput,
  deps: { fetchImpl?: typeof fetch; key?: string | null } = {},
): Promise<SuggestionRow | null> {
  const [job] = await db
    .select({ id: editorJobs.id, workspaceId: editorJobs.workspaceId, brandId: editorJobs.brandId, conversationId: editorJobs.conversationId, manifest: editorJobs.manifest, brandName: brands.name })
    .from(editorJobs)
    .innerJoin(brands, and(eq(brands.id, editorJobs.brandId), eq(brands.workspaceId, editorJobs.workspaceId)))
    .where(eq(editorJobs.id, input.jobId))
    .limit(1);
  if (!job?.brandId) return null;

  const [seen] = await db
    .select({ id: suggestions.id })
    .from(suggestions)
    .where(and(eq(suggestions.editorJobId, job.id), eq(suggestions.source, input.source)))
    .limit(1);
  if (seen) return null;
  const pending = await db.select({ section: suggestions.section }).from(suggestions).where(and(eq(suggestions.brandId, job.brandId), eq(suggestions.status, "pending")));
  if (pending.length >= MAX_PENDING_PER_BRAND) return null;

  const key = deps.key !== undefined ? deps.key : await getCredential(job.workspaceId, "anthropic").catch(() => null);
  if (!key) return null;

  const messages = (
    await db
      .select({ body: conversationMessages.body })
      .from(conversationMessages)
      .where(and(eq(conversationMessages.conversationId, job.conversationId), eq(conversationMessages.direction, "in")))
      .orderBy(desc(conversationMessages.createdAt))
      .limit(8)
  )
    .map((m) => m.body)
    .reverse();

  const proposal = await askForTweak(
    {
      key,
      brandName: job.brandName,
      source: input.source,
      style: await currentStyle(job.brandId),
      messages,
      cuts: describeCuts(input.manifest ?? job.manifest ?? null),
      request: input.request ?? null,
      skip: pending.map((p) => p.section).filter(isStyleSection),
    },
    deps.fetchImpl,
  );
  if (!proposal) return null;

  const [row] = await db
    .insert(suggestions)
    .values({
      workspaceId: job.workspaceId,
      brandId: job.brandId,
      section: proposal.section,
      change: proposal.change,
      reason: proposal.reason,
      source: input.source,
      editorJobId: job.id,
      conversationId: job.conversationId,
    })
    .onConflictDoNothing()
    .returning();
  if (!row) return null;
  await addMessage({
    conversationId: job.conversationId,
    direction: "out",
    channel: "app",
    body: `Suggested a style tweak for ${sectionDef(proposal.section).title}: "${proposal.change}". Accept or dismiss it in Settings > Editor style.`,
  });
  return row;
}

/** Fire-and-forget: runs after the response when there is one, never throws, logs failures. */
export function learnInBackground(input: FeedbackInput): void {
  const run = () =>
    proposeStyleTweak(input).then(
      () => undefined,
      (err: unknown) => console.warn(`[style-learning] job ${input.jobId}: ${(err as Error).message}`),
    );
  try {
    after(run);
  } catch {
    // Outside a request (scripts, tests): just start it.
    void run();
  }
}

// ---- Accept / Dismiss --------------------------------------------------------------------------

export async function pendingSuggestions(brandId: string): Promise<StyleSuggestionView[]> {
  const rows = await db
    .select()
    .from(suggestions)
    .where(and(eq(suggestions.brandId, brandId), eq(suggestions.status, "pending")))
    .orderBy(desc(suggestions.createdAt));
  return rows.map(suggestionView);
}

export async function pendingCount(brandId: string): Promise<number> {
  const [row] = await db.select({ n: count() }).from(suggestions).where(and(eq(suggestions.brandId, brandId), eq(suggestions.status, "pending")));
  return Number(row?.n ?? 0);
}

/** The section's notes with the tweak added as its own line. */
export function notesWithTweak(notes: string, change: string): string {
  const line = `- ${change}`;
  const next = notes.trim() ? `${notes.replace(/\s+$/, "")}\n${line}` : line;
  return next.length > MAX_NOTES_CHARS ? notes : next;
}

/** Accept (adds the tweak to its section as a new version) or dismiss a pending suggestion of this brand. */
export async function decideSuggestion(input: BrandRef & { suggestionId: unknown; decision: "accept" | "dismiss"; userId: string; brandName?: string }): Promise<void> {
  if (typeof input.suggestionId !== "string" || !/^[0-9a-f-]{36}$/i.test(input.suggestionId)) throw new StyleError(SUGGESTION_GONE);
  const now = new Date();
  const [row] = await db
    .update(suggestions)
    .set({ status: input.decision === "accept" ? "accepted" : "dismissed", decidedAt: now, decidedBy: input.userId })
    .where(and(eq(suggestions.id, input.suggestionId), eq(suggestions.brandId, input.brandId), eq(suggestions.status, "pending")))
    .returning();
  if (!row) throw new StyleError(SUGGESTION_GONE);
  if (input.decision === "dismiss" || !isStyleSection(row.section)) return;
  try {
    const value = (await currentStyle(input.brandId))[row.section];
    const notes = notesWithTweak(value.notes, row.change);
    if (notes === value.notes) throw new StyleError("That section's text box is full. Make room, then accept again.");
    await saveStyleSection({
      workspaceId: input.workspaceId,
      brandId: input.brandId,
      brandName: input.brandName,
      section: row.section,
      value: { ...value, notes },
      note: clip(`Suggested tweak: ${row.reason || row.change}`, 500),
      userId: input.userId,
    });
  } catch (err) {
    // Not applied: it goes back to pending so it can be tried again.
    await db.update(suggestions).set({ status: "pending", decidedAt: null, decidedBy: null }).where(eq(suggestions.id, row.id));
    throw err;
  }
}
