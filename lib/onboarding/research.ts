/**
 * Step 4: research a brand with Claude and Anthropic's server-side web tools, and draft its profile.
 *
 * Claude reads the brand's own site (home, about, menu or services pages) with web fetch and looks
 * it up with web search; both run on Anthropic's servers. instagram.com is blocked for both: Instagram
 * captions come only from the brand's connected account (Graph API) or from captions they paste.
 *
 * Pure apart from the injected `call`, so tests run with no network and no key. If the research
 * fails, `draftProfile` falls back to drafting from what the person typed and says so.
 */
import type { ResearchDraft, ResearchProfile } from "./flow";
import { researchOutputSchema, type ResearchOutput } from "./flow-schemas";

export const RESEARCH_MODEL = "claude-opus-5-5";

export interface ResearchInput {
  brandName: string;
  websiteUrl?: string;
  instagramHandle?: string;
  summary: string;
  captions: string[];
  captionsFrom: "instagram" | "pasted" | "none";
}

/** One response from the Messages API, as much of it as this needs. */
export interface ResearchMessage {
  content: Array<{ type: string; [key: string]: unknown }>;
  stop_reason: string | null;
}

/** Sends one Messages API request. `timeoutMs` bounds this request. */
export type MessagesCaller = (body: Record<string, unknown>, opts: { timeoutMs: number }) => Promise<ResearchMessage>;

export class ResearchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResearchError";
  }
}

const MAX_CONTINUATIONS = 4;
const BLOCKED = ["instagram.com"];

export const RESEARCH_TOOLS = [
  { type: "web_fetch_20260209", name: "web_fetch", max_uses: 8, blocked_domains: BLOCKED },
  { type: "web_search_20260209", name: "web_search", max_uses: 4, blocked_domains: BLOCKED },
];

const OUTPUT_SHAPE = `{
  "whatTheyDo": "one or two plain sentences",
  "whoItsFor": "who buys or follows them",
  "voice": { "tone": "how they sound, in a few sentences", "wordsTheyUse": ["..."], "wordsToAvoid": ["..."] },
  "facts": [{ "fact": "a specific, checkable fact", "source": "the exact URL you read it on" }],
  "exampleCaptions": ["an Instagram caption in their voice", "..."]
}`;

const SYSTEM = `You research small brands so an AI video editor can write captions and on-screen text in their voice.
Be specific and factual. Never invent places, products, prices, offers, people or events.
Answer with one JSON object and nothing after it.`;

function describe(input: ResearchInput): string {
  const lines = [`Brand name: ${input.brandName}`, `In their words: ${input.summary}`];
  if (input.websiteUrl) lines.push(`Website: ${input.websiteUrl}`);
  if (input.instagramHandle) lines.push(`Instagram handle: @${input.instagramHandle} (do not fetch instagram.com)`);
  if (input.captions.length) {
    const from = input.captionsFrom === "instagram" ? "Recent captions from their Instagram account" : "Captions they like";
    lines.push(`${from}:\n${input.captions.map((c) => `---\n${c}`).join("\n")}\n---`);
  }
  return lines.join("\n");
}

export function researchPrompt(input: ResearchInput): string {
  const site = input.websiteUrl
    ? `1. Fetch ${input.websiteUrl}, then the pages that say what they offer: about, menu, services, products, locations. Up to 6 pages.\n2. Search the web for the brand name once or twice to find press, listings and locations.`
    : `1. There is no website. Search the web for the brand name to find its site, listings and press, and fetch what you find.`;
  return `${describe(input)}

Research this brand:
${site}
3. Work out their voice from their own writing${input.captions.length ? " and the captions above" : ""}.

Brand facts are the real places, products, menu items, offers, prices and names the editor may mention.
Include a fact only if you read it on a page in this research; set "source" to that page's exact URL.
For a fact taken from the captions above, set "source" to "captions". Skip anything you are unsure of.
Write 3 example captions in their voice that use only these facts.

Reply with this JSON object only:
${OUTPUT_SHAPE}`;
}

function fallbackPrompt(input: ResearchInput): string {
  return `${describe(input)}

Draft this brand's profile from the information above only; you cannot browse.
Brand facts: include only facts stated above, with "source" set to "your description" or "captions".
Write 3 example captions in their voice that use only those facts.

Reply with this JSON object only:
${OUTPUT_SHAPE}`;
}

/** The JSON object in a reply: the last fenced block, else the outermost braces. */
export function extractJson(text: string): unknown {
  const fences = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)];
  const candidate = fences.length ? fences[fences.length - 1]![1]! : text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  if (!candidate.trim()) throw new ResearchError("The research reply had no JSON in it.");
  try {
    return JSON.parse(candidate);
  } catch {
    throw new ResearchError("The research reply was not valid JSON.");
  }
}

/** Validates a reply against the profile schema. */
export function parseResearchOutput(text: string): ResearchOutput {
  const parsed = researchOutputSchema.safeParse(extractJson(text));
  if (!parsed.success) throw new ResearchError(`The research reply did not match the profile: ${parsed.error.issues[0]?.message ?? "invalid"}`);
  return parsed.data;
}

/** A URL reduced to host and path, so the same page compares equal however it was written. */
export function normalizeUrl(raw: string): string | null {
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    const path = u.pathname.replace(/\/+$/, "");
    return `${host}${path}${u.search}`;
  } catch {
    return null;
  }
}

/** Every page the server tools actually returned in these content blocks. */
export function sourcesRead(content: ResearchMessage["content"]): string[] {
  const urls: string[] = [];
  for (const block of content) {
    if (block.type === "web_fetch_tool_result") {
      const result = block.content as { type?: string; url?: unknown } | undefined;
      if (result?.type === "web_fetch_result" && typeof result.url === "string") urls.push(result.url);
    } else if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
      for (const r of block.content as Array<{ url?: unknown }>) if (typeof r.url === "string") urls.push(r.url);
    }
  }
  return [...new Set(urls)];
}

function textOf(content: ResearchMessage["content"]): string {
  return content
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("\n");
}

/** Keeps only facts whose source is a page that was read (or the captions, when there are some). */
export function keepSourcedFacts(facts: ResearchOutput["facts"], read: string[], allowed: string[]): ResearchProfile["facts"] {
  const pages = new Set(read.map(normalizeUrl).filter((u): u is string => Boolean(u)));
  return facts.filter((f) => {
    if (allowed.includes(f.source.toLowerCase())) return true;
    const n = normalizeUrl(f.source);
    return n !== null && pages.has(n);
  });
}

function toProfile(out: ResearchOutput, facts: ResearchProfile["facts"]): ResearchProfile {
  return { whatTheyDo: out.whatTheyDo, whoItsFor: out.whoItsFor, voice: out.voice, facts, exampleCaptions: out.exampleCaptions };
}

function request(system: string, prompt: string, messages: unknown[], withTools: boolean): Record<string, unknown> {
  return {
    model: RESEARCH_MODEL,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    output_config: { effort: "medium" },
    // On a policy decline the API re-runs the request on a fallback model (beta header set by the caller).
    fallbacks: "default",
    system,
    ...(withTools ? { tools: RESEARCH_TOOLS } : {}),
    messages: messages.length ? messages : [{ role: "user", content: prompt }],
  };
}

/** Web research. Throws ResearchError (or the caller's error) when it cannot produce a profile. */
export async function researchBrand(input: ResearchInput, call: MessagesCaller, budgetMs = 210_000): Promise<ResearchDraft> {
  const deadline = Date.now() + budgetMs;
  const prompt = researchPrompt(input);
  const user = { role: "user", content: prompt };
  let assistant: ResearchMessage["content"] = [];
  let stop: string | null = null;

  for (let turn = 0; turn <= MAX_CONTINUATIONS; turn++) {
    const timeoutMs = deadline - Date.now();
    if (timeoutMs < 5_000) throw new ResearchError("The research took too long.");
    // After a pause, send the turn so far back unchanged; the server resumes where it stopped.
    const messages = turn === 0 ? [user] : [user, { role: "assistant", content: assistant }];
    const res = await call(request(SYSTEM, prompt, messages, true), { timeoutMs });
    assistant = [...assistant, ...res.content];
    stop = res.stop_reason;
    if (stop !== "pause_turn") break;
  }
  if (stop === "refusal") throw new ResearchError("Claude declined to research this brand.");
  if (stop === "pause_turn") throw new ResearchError("The research did not finish.");

  const out = parseResearchOutput(textOf(assistant));
  const read = sourcesRead(assistant);
  const allowed = input.captions.length ? ["captions"] : [];
  return { profile: toProfile(out, keepSourcedFacts(out.facts, read, allowed)), sources: read, fallback: false };
}

/** A draft from what they typed alone, without Claude. */
export function draftFromTyped(input: ResearchInput): ResearchProfile {
  return {
    whatTheyDo: input.summary,
    whoItsFor: "",
    voice: { tone: "", wordsTheyUse: [], wordsToAvoid: [] },
    facts: [],
    exampleCaptions: input.captions.slice(0, 3),
  };
}

const FALLBACK_NOTE = "We couldn't research your brand online, so this draft comes only from what you typed. Check it and add your brand facts by hand.";

/** Drafts from what they typed: with Claude (no browsing) when `call` works, else as typed. */
export async function draftFromTypedWithClaude(input: ResearchInput, call: MessagesCaller | null): Promise<ResearchDraft> {
  if (call) {
    try {
      const prompt = fallbackPrompt(input);
      const res = await call(request(SYSTEM, prompt, [], false), { timeoutMs: 45_000 });
      if (res.stop_reason !== "refusal") {
        const out = parseResearchOutput(textOf(res.content));
        const allowed = ["your description", ...(input.captions.length ? ["captions"] : [])];
        return { profile: toProfile(out, keepSourcedFacts(out.facts, [], allowed)), sources: [], fallback: true, note: FALLBACK_NOTE };
      }
    } catch {
      // fall through to the plain draft
    }
  }
  return { profile: draftFromTyped(input), sources: [], fallback: true, note: FALLBACK_NOTE };
}

/** Research, falling back to a draft from what they typed. Never throws. */
export async function draftProfile(input: ResearchInput, call: MessagesCaller | null): Promise<ResearchDraft & { error?: string }> {
  if (call) {
    try {
      return await researchBrand(input, call);
    } catch (err) {
      const draft = await draftFromTypedWithClaude(input, call);
      return { ...draft, error: (err as Error).message };
    }
  }
  return { ...(await draftFromTypedWithClaude(input, null)), error: "No Anthropic key is connected." };
}
