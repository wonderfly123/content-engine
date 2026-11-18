/**
 * Texting through Salesmsg (salesmessage.com), without an SDK: one `sendSms`, the webhook gate, and
 * a parser for Salesmsg's webhook payloads.
 *
 * Texts go out from one Salesmsg inbox (SALESMSG_TEAM_ID, the "Content Engine" inbox,
 * SALESMSG_PHONE_NUMBER). The Salesmsg account also holds other businesses' inboxes, so the webhook
 * only acts on events that positively belong to this inbox and ignores everything else.
 *
 * The API token is not stored here. Salesmsg tokens expire every ~3 days and WD Capital is the one app
 * that rotates them, so we ask it for the current one (SALESMSG_TOKEN_URL, authenticated with
 * SALESMSG_TOKEN_SHARE_SECRET), keep it for a few minutes, and on a 401/403 report it as rejected and
 * retry once. We never call Salesmsg's refresh endpoint ourselves: a second rotator would invalidate
 * WD Capital's copy. SALESMSG_API_TOKEN is only a fallback for local work without the broker.
 *
 * Texting switches on when SALESMSG_TEAM_ID and a token source are set. The webhook refuses
 * every request (403) until SALESMSG_WEBHOOK_SECRET is set; Salesmsg calls it with ?token=<secret>.
 * Salesmsg answers STOP / HELP itself. Never log message bodies or full phone numbers.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { normalizePhone } from "./phone";

const DEFAULT_BASE = "https://api.salesmessage.com/pub/v2.3";
const TIMEOUT_MS = 10_000;

type Env = Record<string, string | undefined>;

export interface SalesmsgConfig {
  /** Fallback token (SALESMSG_API_TOKEN), used only when no broker is set. */
  token: string | null;
  /** WD Capital's token endpoint and its bearer secret, or null. */
  broker: { url: string; secret: string } | null;
  teamId: string;
  /** E.164, or null when not set (then only the inbox id identifies our events). */
  phoneNumber: string | null;
  base: string;
}

/** The Salesmsg settings, or null when the inbox id or every token source is missing. */
export function salesmsgConfig(env: Env = process.env): SalesmsgConfig | null {
  const token = env.SALESMSG_API_TOKEN?.trim() || null;
  const url = env.SALESMSG_TOKEN_URL?.trim();
  const secret = env.SALESMSG_TOKEN_SHARE_SECRET?.trim();
  const broker = url && secret ? { url, secret } : null;
  const teamId = env.SALESMSG_TEAM_ID?.trim();
  if (!teamId || (!token && !broker)) return null;
  const raw = env.SALESMSG_PHONE_NUMBER?.trim();
  return {
    token,
    broker,
    teamId,
    phoneNumber: raw ? normalizePhone(raw) : null,
    base: (env.SALESMSG_API_BASE?.trim() || DEFAULT_BASE).replace(/\/+$/, ""),
  };
}

export const isTextingConfigured = (env: Env = process.env): boolean => salesmsgConfig(env) !== null;

/** The app's public address: APP_URL when set, else the address the request came in on. */
export function appUrl(origin?: string | null, env: Env = process.env): string {
  const configured = env.APP_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  if (origin) return origin.replace(/\/+$/, "");
  const vercel = env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercel) return `https://${vercel}`;
  return "http://localhost:3000";
}

export class TextingNotConfiguredError extends Error {
  constructor() {
    super("Texting is not configured: set SALESMSG_TEAM_ID and SALESMSG_TOKEN_URL + SALESMSG_TOKEN_SHARE_SECRET.");
    this.name = "TextingNotConfiguredError";
  }
}

/** Carries the HTTP status only, never a response body or URL (they hold the number and text). */
export class SalesmsgError extends Error {
  constructor(public readonly status: number) {
    super(`Salesmsg refused the text (HTTP ${status}).`);
    this.name = "SalesmsgError";
  }
}

// ---------------------------------------------------------------------------------------------
// Token, from WD Capital
// ---------------------------------------------------------------------------------------------

const TOKEN_CACHE_MS = 10 * 60 * 1000;
let cachedToken: { token: string; at: number } | null = null;

/** Test hook. */
export function resetSalesmsgTokenCache(): void {
  cachedToken = null;
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/**
 * The current API token: from WD Capital's broker (cached ten minutes), else SALESMSG_API_TOKEN.
 * `rejected` is a token Salesmsg just refused; the broker refreshes it if it is still current.
 * Throws SalesmsgError when no token can be had. Never logs the token.
 */
export async function salesmsgToken(
  config: SalesmsgConfig,
  o: { rejected?: string; fetchImpl?: typeof fetch; now?: number } = {},
): Promise<string> {
  const now = o.now ?? Date.now();
  if (!config.broker) {
    if (config.token) return config.token;
    throw new SalesmsgError(0);
  }
  if (!o.rejected && cachedToken && now - cachedToken.at < TOKEN_CACHE_MS) return cachedToken.token;
  let res: Response;
  try {
    res = await (o.fetchImpl ?? fetch)(config.broker.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.broker.secret}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(o.rejected ? { rejected: sha256(o.rejected) } : {}),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    if (cachedToken && !o.rejected) return cachedToken.token;
    if (config.token) return config.token;
    throw new SalesmsgError(0);
  }
  const json = res.ok ? ((await res.json().catch(() => null)) as { token?: unknown } | null) : null;
  const token = typeof json?.token === "string" ? json.token.trim() : "";
  if (!token) {
    // Broker down or misconfigured: a still-cached token beats nothing.
    if (cachedToken && !o.rejected) return cachedToken.token;
    if (config.token) return config.token;
    throw new SalesmsgError(res.ok ? 0 : res.status);
  }
  cachedToken = { token, at: now };
  return token;
}

/**
 * Sends one text from the Content Engine inbox. Salesmsg's send endpoint takes query parameters
 * (number, team_id, message), not a JSON body. On a 401/403 the token is reported as rejected and
 * the text is tried once more with the replacement. Throws TextingNotConfiguredError without the keys.
 */
export async function sendSms(
  to: string,
  body: string,
  deps: { env?: Env; fetchImpl?: typeof fetch } = {},
): Promise<{ sid: string | null }> {
  const config = salesmsgConfig(deps.env);
  if (!config) throw new TextingNotConfiguredError();
  const doFetch = deps.fetchImpl ?? fetch;
  const qs = new URLSearchParams({ number: to, team_id: config.teamId, message: body });
  const attempt = async (token: string): Promise<Response> => {
    try {
      return await doFetch(`${config.base}/messages?${qs.toString()}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new SalesmsgError(0);
    }
  };
  const token = await salesmsgToken(config, { fetchImpl: doFetch });
  let res = await attempt(token);
  if ((res.status === 401 || res.status === 403) && config.broker) {
    const fresh = await salesmsgToken(config, { rejected: token, fetchImpl: doFetch });
    if (fresh !== token) res = await attempt(fresh);
  }
  if (!res.ok) throw new SalesmsgError(res.status);
  const json = (await res.json().catch(() => null)) as { id?: string | number; data?: { id?: string | number } } | null;
  const id = json?.id ?? json?.data?.id;
  return { sid: id === undefined || id === null ? null : String(id) };
}

// ---------------------------------------------------------------------------------------------
// Webhook
// ---------------------------------------------------------------------------------------------

export function isValidWebhookToken(secret: string, given: string | null): boolean {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export type SalesmsgHandler = (req: NextRequest, payload: unknown) => Promise<Response>;

/**
 * The webhook's gate, used instead of `guard` (Salesmsg has no session). Refuses with 403, before
 * anything touches the database, when the secret is not set or the ?token= does not match it.
 */
export function withSalesmsgToken(handler: SalesmsgHandler): (req: NextRequest) => Promise<Response> {
  return async (req: NextRequest) => {
    const secret = process.env.SALESMSG_WEBHOOK_SECRET?.trim();
    if (!secret) return new Response("Texting is not switched on.", { status: 403 });
    if (!isValidWebhookToken(secret, req.nextUrl.searchParams.get("token"))) {
      return new Response("Invalid token.", { status: 403 });
    }
    let payload: unknown;
    try {
      payload = await req.json();
    } catch {
      return Response.json({ ok: true, ignored: true });
    }
    return handler(req, payload);
  };
}

export interface IncomingSalesmsgText {
  from: string;
  body: string;
  messageId: string | null;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

function pick(o: Obj, path: string): unknown {
  let cur: unknown = o;
  for (const k of path.split(".")) {
    if (!isObj(cur)) return undefined;
    cur = cur[k];
  }
  return cur;
}

function firstValue(o: Obj, paths: string[]): string | null {
  for (const p of paths) {
    const v = pick(o, p);
    if ((typeof v === "string" && v.trim()) || typeof v === "number") return String(v).trim();
  }
  return null;
}

/** Salesmsg marks inbound texts with status "received" (received_at set, no sent_at). */
function isInbound(m: Obj): boolean {
  const str = (k: string) => (typeof m[k] === "string" ? (m[k] as string) : null);
  if (str("status") === "received") return true;
  return !!str("received_at") && !str("sent_at");
}

/**
 * The inbound text in a Salesmsg webhook payload, or null for anything else: texts we sent, calls
 * and voicemails, contact updates, and events from the account's other inboxes.
 *
 * Payload: { event: "message.received", data: { message: { id, status, body, received_at, sent_at, type },
 * contact: { number }, inbox: { id }, number: { number, numberable_id } } } (an unwrapped body is accepted too).
 */
export function parseIncomingText(raw: unknown, config: Pick<SalesmsgConfig, "teamId" | "phoneNumber">): IncomingSalesmsgText | null {
  // Salesmsg wraps the event: { event: "message.received", data: { message, contact, inbox, number } }.
  const payload = isObj(raw) && isObj(raw.data) && !isObj(raw.message) ? raw.data : raw;
  if (isObj(raw) && typeof raw.event === "string" && raw.event !== "message.received") return null;
  if (!isObj(payload) || !isObj(payload.message)) return null;
  const message = payload.message;
  if (/call|voice|record/i.test(typeof message.type === "string" ? message.type : "")) return null;
  if (!isInbound(message)) return null;

  // Only this inbox: a matching inbox id, or our number as the number the text was sent to.
  const inboxId = firstValue(payload, ["inbox.id", "inbox_id", "team_id", "team.id", "message.inbox_id", "message.team_id"]);
  const ourNumberRaw = firstValue(payload, ["number.number", "number", "inbox.number", "message.number"]);
  const ourNumber = ourNumberRaw ? normalizePhone(ourNumberRaw) : null;
  const mine = inboxId === config.teamId || (config.phoneNumber !== null && ourNumber === config.phoneNumber);
  if (!mine) return null;

  const from = firstValue(payload, ["contact.number", "contact.phone", "from"]);
  const body = typeof message.body === "string" ? message.body : "";
  if (!from) return null;
  return { from, body, messageId: firstValue(message, ["id"]) };
}
