/**
 * Upload links: the link texted back after "new reel" / "new story", so clips can be added from a
 * phone without signing in. The link is the key: it lets its holder add clips to one open thread,
 * for UPLOAD_LINK_TTL_MS, and nothing else (no other thread, no reading the thread, no other data).
 *
 * Token: base64url(conversation id (16 bytes) | expiry, unix seconds (4 bytes) | HMAC-SHA256 of the
 * first 20 bytes, truncated to 12 bytes) — 43 characters, short enough for a text. The HMAC key is
 * derived from TOKEN_ENCRYPTION_KEY, so no new secret is needed; changing that key voids every link.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { AccessError, listMemberships } from "@/lib/auth/workspace";
import type { ConversationAccess } from "@/lib/conversations/access";
import { db, schema } from "@/lib/db";

export const UPLOAD_LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SIG_BYTES = 12;
const TOKEN_BYTES = 16 + 4 + SIG_BYTES;

type Env = Record<string, string | undefined>;

function key(env: Env = process.env): Buffer {
  const secret = env.TOKEN_ENCRYPTION_KEY?.trim();
  if (!secret) throw new Error("TOKEN_ENCRYPTION_KEY is not set: upload links are off.");
  return createHmac("sha256", secret).update("nekter-upload-link-v1").digest();
}

const sign = (payload: Buffer, env?: Env) => createHmac("sha256", key(env)).update(payload).digest().subarray(0, SIG_BYTES);

const uuidToBytes = (id: string) => Buffer.from(id.replace(/-/g, ""), "hex");
const bytesToUuid = (b: Buffer) => {
  const h = b.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};

export function createUploadToken(conversationId: string, now: number = Date.now(), env?: Env): string {
  const payload = Buffer.alloc(20);
  uuidToBytes(conversationId).copy(payload, 0);
  payload.writeUInt32BE(Math.floor((now + UPLOAD_LINK_TTL_MS) / 1000), 16);
  return Buffer.concat([payload, sign(payload, env)]).toString("base64url");
}

export type TokenCheck = { ok: true; conversationId: string; expiresAt: Date } | { ok: false; reason: "invalid" | "expired" };

/** Checks a token's signature and expiry (not the thread: see requireUploadLink). */
export function verifyUploadToken(token: unknown, now: number = Date.now(), env?: Env): TokenCheck {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) return { ok: false, reason: "invalid" };
  const raw = Buffer.from(token, "base64url");
  if (raw.length !== TOKEN_BYTES) return { ok: false, reason: "invalid" };
  const payload = raw.subarray(0, 20);
  let expected: Buffer;
  try {
    expected = sign(payload, env);
  } catch {
    return { ok: false, reason: "invalid" };
  }
  if (!timingSafeEqual(expected, raw.subarray(20))) return { ok: false, reason: "invalid" };
  const expiresAt = new Date(payload.readUInt32BE(16) * 1000);
  if (expiresAt.getTime() <= now) return { ok: false, reason: "expired" };
  return { ok: true, conversationId: bytesToUuid(payload.subarray(0, 16)), expiresAt };
}

/** The public page a text links to. */
export const uploadLinkPath = (conversationId: string, now?: number) => `/u/${createUploadToken(conversationId, now)}`;

/**
 * The thread a valid token opens, as if its starter were acting: the token must verify, the thread
 * must exist, and its starter must still be an active member of its workspace. Throws AccessError
 * (404 for anything unknown, 403 for an expired link).
 */
export async function requireUploadLink(token: unknown): Promise<ConversationAccess & { expiresAt: Date; brandName: string | null }> {
  const check = verifyUploadToken(token);
  if (!check.ok) throw new AccessError(check.reason === "expired" ? 403 : 404, check.reason === "expired" ? "This link has expired." : "Not found.");
  const [conversation] = await db.select().from(schema.conversations).where(eq(schema.conversations.id, check.conversationId)).limit(1);
  if (!conversation) throw new AccessError(404, "Not found.");
  const membership = (await listMemberships(conversation.startedBy)).find((m) => m.workspaceId === conversation.workspaceId);
  if (!membership) throw new AccessError(404, "Not found.");
  const [brand] = conversation.brandId
    ? await db.select({ name: schema.brands.name }).from(schema.brands).where(eq(schema.brands.id, conversation.brandId)).limit(1)
    : [];
  return {
    brandName: brand?.name ?? null,
    user: { userId: conversation.startedBy, email: "", role: "user", status: "active" },
    workspaceId: conversation.workspaceId,
    role: membership.role,
    conversation,
    expiresAt: check.expiresAt,
  };
}

/** The route's path parameters: always `token`, plus `mediaId` on the per-clip routes. */
export type UploadLinkParams = { token: string } & Record<string, string>;
export type UploadLinkHandler = (req: NextRequest, access: ConversationAccess, params: UploadLinkParams) => Promise<Response>;

/**
 * The upload-link routes' gate, used instead of `guard` (there is no session). Refuses before any
 * other work unless the token in the path verifies (verifyUploadToken) and opens a live thread.
 */
export function withUploadLink(handler: UploadLinkHandler): (req: NextRequest, ctx: { params: Promise<UploadLinkParams> }) => Promise<Response> {
  return async (req, ctx) => {
    const params = await ctx.params;
    if (!verifyUploadToken(params.token).ok) return NextResponse.json({ error: "This link is invalid or has expired." }, { status: 403 });
    try {
      const access = await requireUploadLink(params.token);
      return await handler(req, access, params);
    } catch (err) {
      if (err instanceof AccessError) return NextResponse.json({ error: err.message }, { status: err.status });
      throw err;
    }
  };
}
