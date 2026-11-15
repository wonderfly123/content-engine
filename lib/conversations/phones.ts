/**
 * A member's mobile number, confirmed with a 6-digit code sent by text. Only confirmed numbers are
 * recognised when a text comes in. A number belongs to one user across the whole platform.
 *
 * The code is stored hashed, expires after 10 minutes and allows 5 tries; sending is rate limited
 * (one code per 30 seconds, five per hour).
 */
import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { and, eq, isNotNull, ne } from "drizzle-orm";
import { requireUser } from "@/lib/auth/workspace";
import { db, schema } from "@/lib/db";
import { normalizePhone } from "./phone";
import { isTextingConfigured, sendSms } from "./twilio";

const { memberPhones } = schema;

export const CODE_TTL_MS = 10 * 60 * 1000;
export const MAX_CODE_ATTEMPTS = 5;
export const MIN_SEND_GAP_MS = 30 * 1000;
export const SEND_WINDOW_MS = 60 * 60 * 1000;
export const MAX_SENDS_PER_WINDOW = 5;

export type PhoneResult = { ok: true } | { ok: false; error: string };

export interface PhoneStatus {
  phone: string;
  verified: boolean;
  /** A code was sent and has not expired yet. */
  codePending: boolean;
}

export interface VerificationDeps {
  send: (to: string, body: string) => Promise<unknown>;
  now: () => Date;
  generateCode: () => string;
}

const defaultDeps: VerificationDeps = {
  send: sendSms,
  now: () => new Date(),
  generateCode: () => String(randomInt(0, 1_000_000)).padStart(6, "0"),
};

const hashCode = (userId: string, code: string) => createHash("sha256").update(`${userId}:${code}`).digest("hex");

async function rowFor(userId: string) {
  const [row] = await db.select().from(memberPhones).where(eq(memberPhones.userId, userId)).limit(1);
  return row ?? null;
}

export async function phoneStatus(userId: string, now: Date = new Date()): Promise<PhoneStatus | null> {
  const row = await rowFor(userId);
  if (!row) return null;
  return {
    phone: row.phoneE164,
    verified: row.verifiedAt !== null,
    codePending: row.codeHash !== null && row.codeExpiresAt !== null && row.codeExpiresAt > now,
  };
}

/** The user a confirmed number belongs to, or null. */
export async function findVerifiedUserByPhone(phone: string): Promise<string | null> {
  const [row] = await db
    .select({ userId: memberPhones.userId })
    .from(memberPhones)
    .where(and(eq(memberPhones.phoneE164, phone), isNotNull(memberPhones.verifiedAt)))
    .limit(1);
  return row?.userId ?? null;
}

const isUniqueViolation = (err: unknown) => {
  const e = err as { code?: string; cause?: { code?: string }; message?: string } | null;
  return e?.code === "23505" || e?.cause?.code === "23505" || /duplicate key|unique constraint/i.test(e?.message ?? "");
};

const TAKEN = "That number is linked to another account.";

/** Stores a fresh code for `rawPhone` and texts it. Replaces any earlier number until confirmed. */
export async function startVerification(userId: string, rawPhone: string, deps: Partial<VerificationDeps> = {}): Promise<PhoneResult> {
  const { send, now: clock, generateCode } = { ...defaultDeps, ...deps };
  const phone = normalizePhone(rawPhone);
  if (!phone) return { ok: false, error: "Enter a mobile number, like (619) 555-0123 or +44 20 7946 0958." };
  const now = clock();

  const [other] = await db
    .select()
    .from(memberPhones)
    .where(and(eq(memberPhones.phoneE164, phone), ne(memberPhones.userId, userId)))
    .limit(1);
  if (other) {
    // Someone else's unconfirmed claim with a code still live blocks it; a stale one is dropped.
    const live = other.verifiedAt !== null || (other.codeExpiresAt !== null && other.codeExpiresAt > now);
    if (live) return { ok: false, error: TAKEN };
    await db.delete(memberPhones).where(and(eq(memberPhones.userId, other.userId), eq(memberPhones.phoneE164, phone)));
  }

  const mine = await rowFor(userId);
  if (mine?.phoneE164 === phone && mine.verifiedAt) return { ok: false, error: "That number is already confirmed." };
  if (mine?.lastCodeSentAt && now.getTime() - mine.lastCodeSentAt.getTime() < MIN_SEND_GAP_MS) {
    return { ok: false, error: "Wait a moment before asking for another code." };
  }
  const windowOpen = mine?.codeWindowStartedAt && now.getTime() - mine.codeWindowStartedAt.getTime() < SEND_WINDOW_MS;
  if (windowOpen && (mine?.codesSentInWindow ?? 0) >= MAX_SENDS_PER_WINDOW) {
    return { ok: false, error: "Too many codes sent. Try again in an hour." };
  }

  const code = generateCode();
  const values = {
    phoneE164: phone,
    verifiedAt: null,
    codeHash: hashCode(userId, code),
    codeExpiresAt: new Date(now.getTime() + CODE_TTL_MS),
    codeAttempts: 0,
    lastCodeSentAt: now,
    codeWindowStartedAt: windowOpen ? mine!.codeWindowStartedAt : now,
    codesSentInWindow: windowOpen ? (mine?.codesSentInWindow ?? 0) + 1 : 1,
    updatedAt: now,
  };
  try {
    if (mine) await db.update(memberPhones).set(values).where(eq(memberPhones.userId, userId));
    else await db.insert(memberPhones).values({ userId, ...values });
  } catch (err) {
    if (isUniqueViolation(err)) return { ok: false, error: TAKEN };
    throw err;
  }

  try {
    await send(phone, `Your Nekter code is ${code}. It expires in 10 minutes.`);
  } catch {
    await db.update(memberPhones).set({ codeHash: null, codeExpiresAt: null }).where(eq(memberPhones.userId, userId));
    return { ok: false, error: "We couldn't send the code. Check the number and try again." };
  }
  return { ok: true };
}

/** Checks a code. Five wrong tries, or ten minutes, and a new code is needed. */
export async function confirmCode(userId: string, rawCode: string, now: Date = new Date()): Promise<PhoneResult> {
  const code = rawCode.replace(/\D/g, "");
  if (code.length !== 6) return { ok: false, error: "Enter the 6-digit code." };
  const row = await rowFor(userId);
  if (!row || !row.codeHash || !row.codeExpiresAt) return { ok: false, error: "Ask for a code first." };
  if (row.codeAttempts >= MAX_CODE_ATTEMPTS) return { ok: false, error: "Too many tries. Ask for a new code." };
  if (row.codeExpiresAt <= now) return { ok: false, error: "That code has expired. Ask for a new one." };

  const expected = Buffer.from(row.codeHash);
  const given = Buffer.from(hashCode(userId, code));
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    const attempts = row.codeAttempts + 1;
    await db.update(memberPhones).set({ codeAttempts: attempts, updatedAt: now }).where(eq(memberPhones.userId, userId));
    return {
      ok: false,
      error: attempts >= MAX_CODE_ATTEMPTS ? "Too many tries. Ask for a new code." : "That code isn't right.",
    };
  }
  await db
    .update(memberPhones)
    .set({ verifiedAt: now, codeHash: null, codeExpiresAt: null, codeAttempts: 0, updatedAt: now })
    .where(eq(memberPhones.userId, userId));
  return { ok: true };
}

export async function removePhone(userId: string): Promise<PhoneResult> {
  await db.delete(memberPhones).where(eq(memberPhones.userId, userId));
  return { ok: true };
}

/** What the Settings card shows the signed-in caller (null when not signed in). */
export async function phoneForCaller(): Promise<{ status: PhoneStatus | null; textingEnabled: boolean } | null> {
  const user = await requireUser().catch(() => null);
  if (!user) return null;
  return { status: await phoneStatus(user.userId), textingEnabled: isTextingConfigured() };
}
