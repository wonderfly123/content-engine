/**
 * POST /api/conversations/[id]/approve — the Approve button: approves this thread's latest finished
 * cut (the same as replying "yes") and posts "Approved." in the app. Scheduling comes later.
 */
import { NextResponse, type NextRequest } from "next/server";
import { guard } from "@/lib/auth/workspace";
import { requireConversation } from "@/lib/conversations/access";
import { approvePendingPreview } from "@/lib/conversations/editor";
import { NOTHING_TO_APPROVE } from "@/lib/conversations/router";
import { postEditorMessage } from "@/lib/editor/notify";

export const runtime = "nodejs";

export const POST = guard(async (_req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> => {
  const { id } = await ctx.params;
  const { conversation } = await requireConversation(id);
  if (conversation.status !== "open") return NextResponse.json({ error: "This conversation is closed." }, { status: 409 });
  const result = await approvePendingPreview(conversation.id);
  if (!result.approved) return NextResponse.json({ error: NOTHING_TO_APPROVE }, { status: 409 });
  await postEditorMessage(conversation, "Approved.", { channel: "app" });
  return NextResponse.json({ approved: true });
});
