/**
 * A cut finished on the phone (lib/editor/phone-final.ts):
 *   POST  /api/conversations/[id]/final { jobId, cutKey, size }                  -> { uploadUrl }
 *   PATCH /api/conversations/[id]/final { jobId, cutKey, size, seconds, shots }  -> the cut now plays and posts that file
 */
import type { NextRequest } from "next/server";
import { guard } from "@/lib/auth/workspace";
import { requireConversation } from "@/lib/conversations/access";
import { completePhoneFinal, startPhoneFinal } from "@/lib/editor/phone-final";

export const runtime = "nodejs";

export const POST = guard(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<Response> => {
  const { id } = await ctx.params;
  return startPhoneFinal(req, await requireConversation(id));
});

export const PATCH = guard(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<Response> => {
  const { id } = await ctx.params;
  return completePhoneFinal(req, await requireConversation(id));
});
