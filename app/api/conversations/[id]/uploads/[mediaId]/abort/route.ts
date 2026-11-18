/** POST /api/conversations/[id]/uploads/[mediaId]/abort — cancel a clip still uploading (lib/media/upload-handlers.ts). */
import type { NextRequest } from "next/server";
import { guard } from "@/lib/auth/workspace";
import { requireConversation } from "@/lib/conversations/access";
import { abortUpload } from "@/lib/media/upload-handlers";

export const runtime = "nodejs";

export const POST = guard(async (_req: NextRequest, ctx: { params: Promise<{ id: string; mediaId: string }> }): Promise<Response> => {
  const { id, mediaId } = await ctx.params;
  return abortUpload(await requireConversation(id), mediaId);
});
