/**
 * POST /api/conversations/[id]/approve — the Approve button: approves this thread's latest finished
 * cut (the same as replying "yes") and posts "Approved." in the app. Scheduling comes later.
 *
 * In a campaign chat, { jobId } names the plan item's cut; approving it also schedules it at the
 * item's plan date (lib/campaigns/run.ts), and the reply says so.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { guard } from "@/lib/auth/workspace";
import { approveItem } from "@/lib/campaigns/run";
import { requireConversation } from "@/lib/conversations/access";
import { approvePendingPreview } from "@/lib/conversations/editor";
import { NOTHING_TO_APPROVE } from "@/lib/conversations/router";
import { addMessage } from "@/lib/conversations/store";
import { postEditorMessage } from "@/lib/editor/notify";

export const runtime = "nodejs";

const bodySchema = z.object({ jobId: z.string().uuid().optional() }).nullable();

export const POST = guard(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> => {
  const { id } = await ctx.params;
  const access = await requireConversation(id);
  const { conversation } = access;
  if (conversation.status !== "open") return NextResponse.json({ error: "This conversation is closed." }, { status: 409 });

  if (conversation.kind === "campaign") {
    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Name the video to approve." }, { status: 400 });
    const result = await approveItem(access, parsed.data?.jobId ?? null);
    if (!result.ok) return NextResponse.json({ error: result.reply }, { status: 409 });
    await addMessage({ conversationId: conversation.id, direction: "out", channel: "app", body: result.reply });
    return NextResponse.json({ approved: true, reply: result.reply });
  }

  const result = await approvePendingPreview(conversation.id);
  if (!result.approved) return NextResponse.json({ error: NOTHING_TO_APPROVE }, { status: 409 });
  await postEditorMessage(conversation, "Approved. Pick when it posts below.", { channel: "app" });
  return NextResponse.json({ approved: true });
});
