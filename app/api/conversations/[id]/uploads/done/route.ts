/** POST /api/conversations/[id]/uploads/done — report a finished batch to the thread and the editor (lib/media/upload-handlers.ts). */
import type { NextRequest } from "next/server";
import { guard } from "@/lib/auth/workspace";
import { requireConversation } from "@/lib/conversations/access";
import { uploadsDone } from "@/lib/media/upload-handlers";

export const runtime = "nodejs";

export const POST = guard(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<Response> => {
  const { id } = await ctx.params;
  return uploadsDone(req, await requireConversation(id));
});
