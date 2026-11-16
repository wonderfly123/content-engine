/**
 * The editor worker (workers/editor, on Modal) calls the app without a session, in two ways:
 *
 *  - asking for upload links: `Authorization: Bearer <MODAL_EDITOR_SECRET>` (`withEditorBearer`);
 *  - its result callback: X-Nekter-Signature = hex HMAC-SHA256(raw body, MODAL_EDITOR_SECRET)
 *    (`withEditorSignature`).
 *
 * Both refuse with 403, before any database work, unless the secret matches, and refuse
 * everything while MODAL_EDITOR_SECRET is not set.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { isValidWorkerSignature, SIGNATURE_HEADER } from "@/lib/media/worker-signature";

/** The editor's callback can pass the optimizer's 16 KB; a manifest with ten cuts and long scripts stays well under this. */
const MAX_CALLBACK_CHARS = 256 * 1024;
const MAX_UPLOADS_CHARS = 16 * 1024;

export const editorSecret = (env: Record<string, string | undefined> = process.env): string | null => env.MODAL_EDITOR_SECRET?.trim() || null;

/** Constant-time check of `Bearer <secret>` (both sides hashed, so lengths never leak). */
export function isValidEditorBearer(secret: string, header: string | null): boolean {
  if (!secret || !header) return false;
  const given = createHash("sha256").update(header.trim()).digest();
  const expected = createHash("sha256").update(`Bearer ${secret}`).digest();
  return timingSafeEqual(given, expected);
}

type Handler = (req: NextRequest, body: unknown) => Promise<Response>;

function parseJson(raw: string): { body: unknown } | Response {
  try {
    return { body: JSON.parse(raw) };
  } catch {
    return new Response("Invalid JSON.", { status: 400 });
  }
}

export function withEditorSignature(handler: Handler): (req: NextRequest) => Promise<Response> {
  return async (req: NextRequest) => {
    const secret = editorSecret();
    if (!secret) return new Response("The editor is not switched on.", { status: 403 });
    let raw: string;
    try {
      raw = await req.text();
    } catch {
      return new Response("Invalid request.", { status: 403 });
    }
    if (raw.length > MAX_CALLBACK_CHARS || !isValidWorkerSignature(secret, raw, req.headers.get(SIGNATURE_HEADER))) {
      return new Response("Invalid signature.", { status: 403 });
    }
    const parsed = parseJson(raw);
    return parsed instanceof Response ? parsed : handler(req, parsed.body);
  };
}

export function withEditorBearer(handler: Handler): (req: NextRequest) => Promise<Response> {
  return async (req: NextRequest) => {
    const secret = editorSecret();
    if (!secret) return new Response("The editor is not switched on.", { status: 403 });
    if (!isValidEditorBearer(secret, req.headers.get("authorization"))) return new Response("Invalid credentials.", { status: 403 });
    let raw: string;
    try {
      raw = await req.text();
    } catch {
      return new Response("Invalid request.", { status: 403 });
    }
    if (raw.length > MAX_UPLOADS_CHARS) return new Response("Request too large.", { status: 413 });
    const parsed = parseJson(raw);
    return parsed instanceof Response ? parsed : handler(req, parsed.body);
  };
}
