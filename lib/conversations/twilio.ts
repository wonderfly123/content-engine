/**
 * Twilio, without the Twilio SDK: webhook signature checks, TwiML replies, and one `sendSms` for
 * texts sent outside a webhook reply (today: the phone confirmation code).
 *
 * Texting switches on when TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_PHONE_NUMBER are all
 * set. Until then the webhook refuses every request (403) and `sendSms` throws.
 * Never log message bodies or full phone numbers.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

export interface TwilioConfig {
  accountSid: string;
  authToken: string;
  phoneNumber: string;
}

type Env = Record<string, string | undefined>;

/** The Twilio keys, or null when any of the three is missing or blank. */
export function twilioConfig(env: Env = process.env): TwilioConfig | null {
  const accountSid = env.TWILIO_ACCOUNT_SID?.trim();
  const authToken = env.TWILIO_AUTH_TOKEN?.trim();
  const phoneNumber = env.TWILIO_PHONE_NUMBER?.trim();
  if (!accountSid || !authToken || !phoneNumber) return null;
  return { accountSid, authToken, phoneNumber };
}

export const isTextingConfigured = (env: Env = process.env): boolean => twilioConfig(env) !== null;

/** The app's public address: APP_URL when set, else the address the request came in on. */
export function appUrl(origin?: string | null, env: Env = process.env): string {
  const configured = env.APP_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  if (origin) return origin.replace(/\/+$/, "");
  const vercel = env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercel) return `https://${vercel}`;
  return "http://localhost:3000";
}

/**
 * Twilio signs each webhook: HMAC-SHA1 over the full URL followed by every POST parameter
 * (sorted by name, name then value), keyed with the auth token, base64-encoded.
 */
export function twilioSignature(authToken: string, url: string, params: Record<string, string>): string {
  const data = Object.keys(params)
    .sort()
    .reduce((acc, name) => acc + name + params[name], url);
  return createHmac("sha1", authToken).update(Buffer.from(data, "utf-8")).digest("base64");
}

export function isValidTwilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string>,
  header: string | null,
): boolean {
  if (!header) return false;
  const expected = Buffer.from(twilioSignature(authToken, url, params));
  const given = Buffer.from(header);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** TwiML reply. With no message, Twilio sends nothing back. */
export function twiml(message?: string | null): string {
  const body = message ? `<Message>${escapeXml(message)}</Message>` : "";
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`;
}

export function twimlResponse(message?: string | null): Response {
  return new Response(twiml(message), { status: 200, headers: { "Content-Type": "text/xml; charset=utf-8" } });
}

/** The URL Twilio signed: the public one it was configured with, not whatever host the request reached. */
export function signedUrl(req: NextRequest, env: Env = process.env): string {
  if (env.APP_URL?.trim()) return `${appUrl(null, env)}${req.nextUrl.pathname}${req.nextUrl.search}`;
  return req.url;
}

export type TwilioHandler = (req: NextRequest, params: Record<string, string>) => Promise<Response>;

/**
 * The webhook's gate, used instead of `guard` (Twilio has no session). Refuses with 403, before
 * anything touches the database, when the auth token is not set or the signature does not match.
 */
export function withTwilioSignature(handler: TwilioHandler): (req: NextRequest) => Promise<Response> {
  return async (req: NextRequest) => {
    const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
    if (!authToken) return new Response("Texting is not switched on.", { status: 403 });
    let params: Record<string, string>;
    try {
      const form = await req.formData();
      params = {};
      form.forEach((value, key) => {
        if (typeof value === "string") params[key] = value;
      });
    } catch {
      return new Response("Invalid request.", { status: 403 });
    }
    if (!isValidTwilioSignature(authToken, signedUrl(req), params, req.headers.get("x-twilio-signature"))) {
      return new Response("Invalid signature.", { status: 403 });
    }
    return handler(req, params);
  };
}

export class TextingNotConfiguredError extends Error {
  constructor() {
    super("Texting is not configured: set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_PHONE_NUMBER.");
    this.name = "TextingNotConfiguredError";
  }
}

/** Sends one text through Twilio's REST API. Throws TextingNotConfiguredError when the keys are missing. */
export async function sendSms(to: string, body: string): Promise<{ sid: string | null }> {
  const config = twilioConfig();
  if (!config) throw new TextingNotConfiguredError();
  const auth = Buffer.from(`${config.accountSid}:${config.authToken}`).toString("base64");
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(config.accountSid)}/Messages.json`, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ To: to, From: config.phoneNumber, Body: body }).toString(),
  });
  if (!res.ok) throw new Error(`Twilio refused the text (HTTP ${res.status}).`);
  const json = (await res.json().catch(() => ({}))) as { sid?: string };
  return { sid: json.sid ?? null };
}
