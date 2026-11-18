/** POST /api/conversations/[id]/uploads — start uploading one clip into an open thread (lib/media/upload-handlers.ts). */
import type { NextRequest } from "next/server";
import { guard } from "@/lib/auth/workspace";
import { requireConversation } from "@/lib/conversations/access";
import { startUpload } from "@/lib/media/upload-handlers";

export const runtime = "nodejs";

export const POST = guard(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<Response> => {
  const { id } = await ctx.params;
  return startUpload(req, await requireConversation(id));
});
