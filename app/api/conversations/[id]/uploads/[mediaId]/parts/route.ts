/** POST /api/conversations/[id]/uploads/[mediaId]/parts — presigned part URLs (lib/media/upload-handlers.ts). */
import type { NextRequest } from "next/server";
import { guard } from "@/lib/auth/workspace";
import { requireConversation } from "@/lib/conversations/access";
import { partUrls } from "@/lib/media/upload-handlers";

export const runtime = "nodejs";

export const POST = guard(async (req: NextRequest, ctx: { params: Promise<{ id: string; mediaId: string }> }): Promise<Response> => {
  const { id, mediaId } = await ctx.params;
  return partUrls(req, await requireConversation(id), mediaId);
});
