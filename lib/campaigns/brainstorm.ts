/**
 * The campaign editor's side of the chat: an app-side Claude call (not the Modal worker) that riffs
 * on theme, goal and audience, and writes or changes the plan only when the person is ready.
 *
 * It sees the brand, the plan so far (with each item's status) and the brand's clip library, one
 * compact line per clip (newest 300). Clips are named by short refs ("c12"), mapped back to asset ids
 * here, so the model never handles ids and can only pick clips that are in this brand's library.
 * Uses the workspace's own Anthropic key, like naming and clip descriptions.
 */
import { and, desc, eq } from "drizzle-orm";
import { getCredential } from "@/lib/credentials/store";
import { db, schema } from "@/lib/db";
import { brandVoice } from "@/lib/editor/brand-voice";
import { postingTimeZone } from "@/lib/conversations/post-time";
import type { CampaignRow, ItemState, LibraryClip } from "./store";

export const CAMPAIGN_MODEL = "claude-opus-5-5";
const TIMEOUT_MS = 240_000;
const HISTORY_MESSAGES = 40;
const MAX_MESSAGE_CHARS = 2000;

export const BRAINSTORM_ACTIONS = ["chat", "write_plan", "approve_plan", "make_next"] as const;
export type BrainstormAction = (typeof BRAINSTORM_ACTIONS)[number];

export interface PlanItemDraft {
  /** The existing item's number this entry stands for, or 0 for a new one. */
  number: number;
  title: string;
  angle: string;
  hook: string;
  lengthSec: number;
  format: string;
  music: string;
  clips: string[];
  postAt: string;
}

export interface PlanDraft {
  name: string;
  theme: string;
  goal: string;
  audience: string;
  items: PlanItemDraft[];
}

export interface BrainstormOutput {
  reply: string;
  action: BrainstormAction;
  plan: PlanDraft;
}

const OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["reply", "action", "plan"],
  properties: {
    reply: { type: "string", description: "What you say back in the chat: plain text, short, no markdown." },
    action: {
      type: "string",
      enum: [...BRAINSTORM_ACTIONS],
      description:
        "chat: keep talking. write_plan: write or change the plan (the person asked for it or agreed). approve_plan: the person approved the plan and its posting calendar. make_next: the person wants the next video made now.",
    },
    plan: {
      type: "object",
      additionalProperties: false,
      required: ["name", "theme", "goal", "audience", "items"],
      description: "With write_plan: the whole plan, every item. Otherwise empty strings and no items.",
      properties: {
        name: { type: "string", description: "2 to 5 words naming the campaign" },
        theme: { type: "string" },
        goal: { type: "string" },
        audience: { type: "string" },
        items: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["number", "title", "angle", "hook", "lengthSec", "format", "music", "clips", "postAt"],
            properties: {
              number: { type: "integer", description: "The existing item's number this entry keeps, or 0 for a new video" },
              title: { type: "string" },
              angle: { type: "string", description: "What this video is about and why it is different from the others" },
              hook: { type: "string", description: "The opening line or moment that stops the scroll" },
              lengthSec: { type: "integer", enum: [15, 30, 60] },
              format: { type: "string", enum: ["reel", "story"] },
              music: { type: "string", description: "Music and pacing note, e.g. 'upbeat, fast cuts on the beat'" },
              clips: { type: "array", items: { type: "string" }, description: "Library clip refs (c1, c2, ...) this video would use" },
              postAt: { type: "string", description: "When it posts: ISO 8601 date-time with offset" },
            },
          },
        },
      },
    },
  },
} as const;

/** "c1 | Truck loading | 12s | Two people load a truck at dusk | truck loading, wide, outdoor" */
export function libraryLines(library: LibraryClip[]): string {
  return library
    .map((c, i) => {
      const tags = c.tags.slice(0, 8).join(", ");
      const desc = (c.description ?? "").replace(/\s+/g, " ").slice(0, 160);
      return `c${i + 1} | ${c.label.replace(/\s+/g, " ").slice(0, 60)} | ${c.durationSec ? `${c.durationSec}s` : "?s"} | ${desc} | ${tags}`;
    })
    .join("\n");
}

/** The plan so far, for the prompt: one line per item with its status and clip refs. */
export function planLines(campaign: CampaignRow, states: ItemState[], refOf: Map<string, string>): string {
  if (states.length === 0) return "No plan yet.";
  const head = `Campaign "${campaign.name}". Theme: ${campaign.theme}. Goal: ${campaign.goal}. Audience: ${campaign.audience}. Calendar ${campaign.calendarApprovedAt ? "approved" : "not approved yet"}.`;
  const lines = states.map(({ item, status }) => {
    const clips = item.assetIds.map((id) => refOf.get(id)).filter(Boolean).join(" ");
    return `#${item.position} [${status}] ${item.title} | ${item.lengthSec}s ${item.format} | posts ${item.postAt.toISOString()} | angle: ${item.angle} | hook: ${item.hook} | music: ${item.music} | clips: ${clips || "none"}`;
  });
  return `${head}\n${lines.join("\n")}`;
}

const RULES = `You are the video editor in a campaign chat for a small brand's Instagram. You plan a campaign of short vertical videos (reels and stories) made from the brand's own footage, then the app makes them one at a time.

How the chat goes:
- First brainstorm. Ask about the theme, the goal and the audience if you don't know them (one or two questions at a time), and riff ideas back and forth. Be concrete about which footage fits.
- Write the plan (action write_plan) only when the person asks for it ("make the plan") or agrees when you offer. Never write it unasked.
- Default to 20 videos, but suggest more or fewer depending on how much footage fits the theme; say why.
- Vary the videos: hook and angle, length (15, 30 or 60 seconds), reel or story, and music/pacing. Every video uses clips from the library that actually fit it.
- The plan includes a posting calendar: give each video a sensible time (spread over days or weeks, good posting hours in the brand's time zone). Ask the person to approve the plan and calendar once.
- The person can change the plan in chat ("make it 12", "drop #4", "swap #7 to a story"): answer with write_plan and the whole new plan. Videos whose status is not "planned" are already made or being made: keep them unchanged with their number.
- action approve_plan when the person approves the plan and calendar; action make_next when they want the next video made now ("go", "next", "start"). Nothing is made until they say so.
- With action chat, approve_plan or make_next, send the plan with empty strings and no items.
- Plain text only, short, in the brand's voice. Never invent facts (places, names, prices) the person did not give or the footage does not show.`;

type ApiMessage = { role: "user" | "assistant"; content: string };

/** The chat so far (newest 40), as alternating turns that start with the person. */
async function history(conversationId: string): Promise<ApiMessage[]> {
  const rows = await db
    .select({ direction: schema.conversationMessages.direction, body: schema.conversationMessages.body })
    .from(schema.conversationMessages)
    .where(eq(schema.conversationMessages.conversationId, conversationId))
    .orderBy(desc(schema.conversationMessages.createdAt), desc(schema.conversationMessages.direction))
    .limit(HISTORY_MESSAGES);
  const turns = rows.reverse().map((r): ApiMessage => ({ role: r.direction === "in" ? "user" : "assistant", content: r.body.slice(0, MAX_MESSAGE_CHARS) }));
  if (turns[0]?.role !== "user") turns.unshift({ role: "user", content: "(I started a new campaign.)" });
  return turns;
}

export interface BrainstormInput {
  workspaceId: string;
  brandId: string;
  conversationId: string;
  campaign: CampaignRow;
  states: ItemState[];
  library: LibraryClip[];
  now?: Date;
}

export async function brainstorm(input: BrainstormInput, deps: { fetchImpl?: typeof fetch; key?: string | null } = {}): Promise<BrainstormOutput | { error: string }> {
  const key = deps.key !== undefined ? deps.key : await getCredential(input.workspaceId, "anthropic").catch(() => null);
  if (!key) return { error: "no_key" };
  const [brand] = await db
    .select()
    .from(schema.brands)
    .where(and(eq(schema.brands.id, input.brandId), eq(schema.brands.workspaceId, input.workspaceId)))
    .limit(1);
  if (!brand) return { error: "no_brand" };
  const refOf = new Map(input.library.map((c, i) => [c.assetId, `c${i + 1}`]));
  const now = input.now ?? new Date();
  const stable =
    `${RULES}\n\nBrand: ${brand.name}\nVoice: ${brandVoice(brand) || "(none given)"}\n\n` +
    `Library (${input.library.length} clips, newest first; ref | title | length | what it shows | tags):\n${libraryLines(input.library) || "(empty: the person can upload clips in this chat)"}`;
  const state = `Now: ${now.toISOString()} (brand time zone ${postingTimeZone()}).\n\nThe plan so far:\n${planLines(input.campaign, input.states, refOf)}`;
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
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body: JSON.stringify({
        model: CAMPAIGN_MODEL,
        max_tokens: 24000,
        fallbacks: "default",
        output_config: { effort: "medium", format: { type: "json_schema", schema: OUTPUT_SCHEMA } },
        // The rules and library stay the same turn to turn: cached. The plan's state changes.
        system: [
          { type: "text", text: stable, cache_control: { type: "ephemeral" } },
          { type: "text", text: state },
        ],
        messages: await history(input.conversationId),
      }),
    });
    if (!res.ok) return { error: `http_${res.status}` };
    const json = (await res.json()) as { stop_reason?: string; content?: Array<{ type: string; text?: string }> };
    if (json.stop_reason === "refusal") return { error: "refusal" };
    const text = json.content?.find((c) => c.type === "text")?.text ?? "";
    const out = JSON.parse(text) as BrainstormOutput;
    if (typeof out.reply !== "string" || !BRAINSTORM_ACTIONS.includes(out.action)) return { error: "shape" };
    return out;
  } catch (err) {
    return { error: `failed_${(err as Error).name}` };
  }
}
