/**
 * The optimizer worker (workers/optimize, on Modal) calls back without a session. It proves itself
 * by signing the raw request body: X-Nekter-Signature = hex HMAC-SHA256(body, MODAL_OPTIMIZE_SECRET).
 * `withWorkerSignature` refuses with 403, before any database work, unless that signature matches
 * (and refuses everything while MODAL_OPTIMIZE_SECRET is not set).
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

export const SIGNATURE_HEADER = "x-nekter-signature";
/** Callbacks are small JSON documents; anything bigger is not one. */
const MAX_BODY_CHARS = 16 * 1024;

export const optimizeSecret = (env: Record<string, string | undefined> = process.env): string | null => env.MODAL_OPTIMIZE_SECRET?.trim() || null;

export const signWorkerBody = (secret: string, rawBody: string): string => createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");

export function isValidWorkerSignature(secret: string, rawBody: string, signature: string | null): boolean {
  if (!secret || !signature || !/^[0-9a-f]{64}$/i.test(signature.trim())) return false;
  const expected = Buffer.from(signWorkerBody(secret, rawBody), "hex");
  const given = Buffer.from(signature.trim().toLowerCase(), "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

type WorkerHandler = (req: NextRequest, body: unknown) => Promise<Response>;

export function withWorkerSignature(handler: WorkerHandler): (req: NextRequest) => Promise<Response> {
  return async (req: NextRequest) => {
    const secret = optimizeSecret();
    if (!secret) return new Response("Optimizing is not switched on.", { status: 403 });
    let raw: string;
    try {
      raw = await req.text();
    } catch {
      return new Response("Invalid request.", { status: 403 });
    }
    if (raw.length > MAX_BODY_CHARS || !isValidWorkerSignature(secret, raw, req.headers.get(SIGNATURE_HEADER))) {
      return new Response("Invalid signature.", { status: 403 });
    }
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return new Response("Invalid JSON.", { status: 400 });
    }
    return handler(req, body);
  };
}
