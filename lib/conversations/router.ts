/**
 * What an incoming message means, and what to say back. Pure: no database, no network.
 *
 * The same rules apply to a text and to a message typed in the app. Control messages (new reel /
 * new story, answers to "Reel or story?" and "Which brand?", "yes", carrier keywords) are handled
 * here; everything else is an ordinary message for the editor (lib/conversations/editor.ts).
 */
import type { ConversationKind, MessageChannel } from "@/lib/db/enums";

export interface BrandRef {
  id: string;
  name: string;
  slug: string;
}

/** The thread the message lands in (a fresh one when the person has none open). */
export interface ThreadState {
  kind: ConversationKind | null;
  brandId: string | null;
}

export type Decision =
  /** STOP / START / HELP and friends, texts only. Salesmsg answers these itself, so we stay silent. */
  | { type: "keyword"; keyword: "stop" | "start" | "help" }
  /** "new reel" / "new story": close the open thread and open a new one. */
  | { type: "new_thread"; kind: ConversationKind; brandId: string | null }
  /** "yes": approve this thread's pending preview. */
  | { type: "approve" }
  /** Only answers an open question (kind and/or brand), nothing else to do. */
  | { type: "answer"; kind?: ConversationKind; brandId?: string }
  /** Anything else: goes to the editor. A brand named in passing is remembered. */
  | { type: "message"; brandId?: string };

export interface DecideInput {
  body: string;
  channel: MessageChannel;
  thread: ThreadState;
  /** The workspace's active brands. */
  brands: BrandRef[];
}

const STOP_WORDS = new Set(["stop", "stopall", "unsubscribe", "cancel", "end", "quit", "revoke", "optout"]);
const START_WORDS = new Set(["start", "unstop"]);
const HELP_WORDS = new Set(["help", "info"]);
const YES = new Set([
  "yes", "y", "yeah", "yea", "yep", "yup", "ya", "yes please", "yess", "yesss", "approve", "approved", "ok", "okay",
  "sure", "looks good", "look good", "lgtm", "sounds good", "do it", "ship it", "perfect", "go ahead", "post it",
]);
const KIND_WORDS: Record<string, ConversationKind> = { reel: "reel", reels: "reel", story: "story", stories: "story" };
/** Words that carry no meaning in a short answer like "a reel for windansea please". */
const FILLER = new Set([
  "a", "an", "the", "its", "it", "is", "for", "please", "pls", "plz", "brand", "one", "this", "that", "thanks", "thank",
  "you", "just", "make", "lets", "do", "new", "on", "with", "me", "i", "want", "id", "like", "hi", "hey",
]);

/** Lowercase, punctuation to spaces, single spaces. Letters and digits of any language are kept. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['’]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

const compact = (text: string) => normalize(text).replace(/\s+/g, "");

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/** Ways to say a brand: its whole name, its slug, and the first word of each ("windansea"). */
function brandNames(brand: BrandRef): string[] {
  const names = [
    compact(brand.name),
    compact(brand.slug),
    normalize(brand.name).split(" ")[0] ?? "",
    normalize(brand.slug).split(" ")[0] ?? "",
  ];
  return [...new Set(names.filter((n) => n.length >= 3))];
}

/**
 * Forgiving match of a short answer to one brand: exact name or slug, the start of one, or a small
 * typo ("windandsea" for "Windansea Coconuts"). Null when nothing matches or two brands tie.
 */
export function matchBrand(text: string, brands: BrandRef[]): BrandRef | null {
  const t = compact(text);
  if (t.length < 2) return null;
  let best: { brand: BrandRef; score: number } | null = null;
  let tie = false;
  for (const brand of brands) {
    let score = Infinity;
    for (const name of brandNames(brand)) {
      if (name === t) score = Math.min(score, 0);
      else if (t.length >= 3 && name.startsWith(t)) score = Math.min(score, 0.5);
      else {
        const allowed = name.length >= 8 ? 2 : name.length >= 5 ? 1 : 0;
        const d = levenshtein(t, name);
        if (d <= allowed) score = Math.min(score, d);
      }
    }
    if (score === Infinity) continue;
    if (!best || score < best.score) {
      best = { brand, score };
      tie = false;
    } else if (score === best.score && best.brand.id !== brand.id) tie = true;
  }
  return best && !tie ? best.brand : null;
}

/** A brand named exactly (whole name or slug) somewhere in a longer message. */
function mentionedBrand(normalized: string, brands: BrandRef[]): BrandRef | null {
  const padded = ` ${normalized} `;
  const tokens = new Set(normalized.split(" "));
  const hits = brands.filter((b) => padded.includes(` ${normalize(b.name)} `) || tokens.has(compact(b.slug)) || tokens.has(compact(b.name)));
  return hits.length === 1 ? hits[0] : null;
}

const isYes = (raw: string, normalized: string) => YES.has(normalized) || /^\s*(👍|✅|👌)+\s*$/u.test(raw);

/** STOP / START / HELP (and their variants), which carriers require and Salesmsg answers itself. */
export function carrierKeyword(body: string): "stop" | "start" | "help" | null {
  const text = normalize(body);
  if (STOP_WORDS.has(text)) return "stop";
  if (START_WORDS.has(text)) return "start";
  if (HELP_WORDS.has(text)) return "help";
  return null;
}

export function decide({ body, channel, thread, brands }: DecideInput): Decision {
  const text = normalize(body);
  const single = brands.length === 1 ? brands[0] : null;

  const keyword = channel === "sms" ? carrierKeyword(body) : null;
  if (keyword) return { type: "keyword", keyword };

  const fresh = /^new (reels?|stor(?:y|ies))(?: (.*))?$/.exec(text);
  if (fresh) {
    const kind = KIND_WORDS[fresh[1]];
    const named = fresh[2] ? matchBrand(fresh[2].split(" ").filter((w) => !FILLER.has(w)).join(" "), brands) : null;
    return { type: "new_thread", kind, brandId: single?.id ?? named?.id ?? null };
  }

  if (isYes(body, text)) return { type: "approve" };

  const needsKind = thread.kind === null;
  const needsBrand = thread.brandId === null && brands.length > 1;
  const tokens = text ? text.split(" ") : [];
  const kindsSaid = [...new Set(tokens.filter((w) => w in KIND_WORDS).map((w) => KIND_WORDS[w]))];
  const rest = tokens.filter((w) => !(w in KIND_WORDS) && !FILLER.has(w));

  const kind = needsKind && kindsSaid.length === 1 ? kindsSaid[0] : undefined;
  const brand = needsBrand && rest.length > 0 ? matchBrand(rest.join(" "), brands) : null;
  const leftover = brand ? [] : rest;
  const kindOk = kindsSaid.length === 0 || kind !== undefined;
  if ((kind || brand) && leftover.length === 0 && kindOk) {
    return { type: "answer", ...(kind ? { kind } : {}), ...(brand ? { brandId: brand.id } : {}) };
  }

  const mentioned = needsBrand ? mentionedBrand(text, brands) : null;
  return mentioned ? { type: "message", brandId: mentioned.id } : { type: "message" };
}

// ---------------------------------------------------------------------------------------------
// Replies
// ---------------------------------------------------------------------------------------------

export const KIND_QUESTION = "Reel or story?";
/** Replies start with this when asking for the brand; the store looks for it to ask only once. */
export const BRAND_QUESTION_PREFIX = "Which brand:";

/** "A", "A or B", "A, B or C". */
export function listBrands(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
}

export interface ReplyContext {
  channel: MessageChannel;
  /** The thread after the message was applied. */
  thread: ThreadState;
  brands: BrandRef[];
  /** Whether this thread has already asked which brand (it asks once). */
  askedBrand: boolean;
  /** Link to the thread in the app. */
  link: string;
}

/** The question still open on a thread, if any: kind first, then brand (once). */
export function nextQuestion(ctx: ReplyContext): string | null {
  if (ctx.thread.kind === null) return KIND_QUESTION;
  if (ctx.thread.brandId === null && ctx.brands.length > 1 && !ctx.askedBrand) {
    return `${BRAND_QUESTION_PREFIX} ${listBrands(ctx.brands.map((b) => b.name))}?`;
  }
  return null;
}

/** Clips cannot come by text (carrier limits): texts get a link to the thread in the app. */
export function footageLine(channel: MessageChannel, link: string): string {
  return channel === "sms" ? `Send your clips in the app: ${link}` : "Add your clips with the paperclip below, or drop them in.";
}

function subject(ctx: ReplyContext): string {
  const brand = ctx.brands.find((b) => b.id === ctx.thread.brandId);
  const kind = ctx.thread.kind ?? "video";
  return brand ? `${kind} for ${brand.name}` : kind;
}

export const EDITOR_NOT_CONNECTED = "Got it. The editor isn't connected yet, so I can't make changes for now.";
export const NOTHING_TO_APPROVE = "There's nothing waiting for your approval yet.";

/**
 * What to say back after a decision has been applied. Null means say nothing. `editor` is the
 * editor seam's answer for an ordinary message (its own reply, when it has one, is used as is).
 */
export function replyFor(decision: Decision, ctx: ReplyContext, editor?: { queued: boolean; reply?: string | null }): string | null {
  const question = nextQuestion(ctx);
  switch (decision.type) {
    case "keyword":
      return null;
    case "approve":
      return NOTHING_TO_APPROVE;
    case "new_thread":
      return `New ${subject(ctx)} started. ${question ?? footageLine(ctx.channel, ctx.link)}`;
    case "answer":
      return question ? `Got it. ${question}` : `Got it: a ${subject(ctx)}. ${footageLine(ctx.channel, ctx.link)}`;
    case "message": {
      // A question still open means the editor did not run: ask it.
      if (question) return editor ? `Got it. ${question}` : `${EDITOR_NOT_CONNECTED} ${question}`;
      if (editor?.reply) return editor.reply;
      return editor?.queued ? "Got it. The editor is on it." : EDITOR_NOT_CONNECTED;
    }
  }
}

export const UNKNOWN_NUMBER_REPLY =
  "This number isn't linked to an account. Add and confirm it under a brand's Settings > Channels in the app to text the editor.";

/** A confirmed number that is not turned on for any brand. */
export const NO_BRAND_REPLY =
  "Texting isn't on for any of your brands. Turn it on under a brand's Settings > Channels in the app.";
