"use server";

/**
 * The caller's own mobile number, for texting the editor: add it, confirm it with the code sent
 * by text, or remove it. Acts only on the signed-in caller's own number.
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { tryWorkspace } from "@/lib/auth/workspace";
import { confirmCode, removePhone as removeMemberPhone, startVerification, type PhoneResult } from "@/lib/conversations/phones";
import { isTextingConfigured } from "@/lib/conversations/twilio";

// Carriers require a clear, separate yes before any text is sent; the box is never pre-ticked.
const phoneSchema = z.object({
  phone: z.string().trim().min(7, "Enter a mobile number.").max(32),
  consent: z.literal(true, { errorMap: () => ({ message: "Tick the box to agree to receive texts." }) }),
});
const codeSchema = z.object({ code: z.string().trim().min(6, "Enter the 6-digit code.").max(12) });

async function caller(): Promise<{ userId: string } | { error: string }> {
  const access = await tryWorkspace();
  if (!access) return { error: "Sign in to manage your number." };
  return { userId: access.user.userId };
}

export async function startPhoneVerification(input: { phone: string; consent: boolean }): Promise<PhoneResult> {
  const parsed = phoneSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Enter a mobile number." };
  const who = await caller();
  if ("error" in who) return { ok: false, error: who.error };
  if (!isTextingConfigured()) return { ok: false, error: "Texting isn't switched on yet." };
  const result = await startVerification(who.userId, parsed.data.phone);
  revalidatePath("/settings");
  return result;
}

export async function confirmPhone(input: { code: string }): Promise<PhoneResult> {
  const parsed = codeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Enter the 6-digit code." };
  const who = await caller();
  if ("error" in who) return { ok: false, error: who.error };
  const result = await confirmCode(who.userId, parsed.data.code);
  revalidatePath("/settings");
  return result;
}

export async function removePhone(): Promise<PhoneResult> {
  const who = await caller();
  if ("error" in who) return { ok: false, error: who.error };
  const result = await removeMemberPhone(who.userId);
  revalidatePath("/settings");
  return result;
}
