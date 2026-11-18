/**
 * The campaign plan pinned at the top of a campaign chat (lib/campaigns):
 *   GET  -> { campaign }  the plan and each video's status; null for a reel or story chat
 *   POST { action: "approve_plan" } -> approves the plan's posting calendar (once)
 *   POST { action: "next" }         -> "Make next video": exactly one editor job for the next planned video
 * Each step is posted in the chat, like the same words typed there.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { guard } from "@/lib/auth/workspace";
import { approveCalendar, startNextItem } from "@/lib/campaigns/run";
import { campaignFor, planItems } from "@/lib/campaigns/store";
import { campaignView } from "@/lib/campaigns/view";
import { requireConversation } from "@/lib/conversations/access";
import { addMessage } from "@/lib/conversations/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = guard(async (_req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> => {
  const { id } = await ctx.params;
  const { conversation } = await requireConversation(id);
  return NextResponse.json({ campaign: await campaignView(conversation) });
});

const bodySchema = z.object({ action: z.enum(["approve_plan", "next"]) });

export const POST = guard(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> => {
  const { id } = await ctx.params;
  const access = await requireConversation(id);
  const thread = access.conversation;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  if (thread.kind !== "campaign") return NextResponse.json({ error: "This isn't a campaign." }, { status: 409 });
  if (thread.status !== "open") return NextResponse.json({ error: "This conversation is closed." }, { status: 409 });
  const campaign = await campaignFor(thread);
  if (!campaign) return NextResponse.json({ error: "This isn't a campaign." }, { status: 409 });

  const say = (body: string) => addMessage({ conversationId: thread.id, direction: "in", channel: "app", body, authorUserId: access.user.userId });
  if (parsed.data.action === "approve_plan") {
    if ((await planItems(campaign.id)).length === 0) return NextResponse.json({ error: "There's no plan to approve yet." }, { status: 409 });
    await say("Approve the plan and calendar");
    await approveCalendar(campaign);
    const reply = "Plan and calendar approved. Say go (or tap Make next video) when you want the first one.";
    await addMessage({ conversationId: thread.id, direction: "out", channel: "app", body: reply });
    return NextResponse.json({ campaign: await campaignView(thread), reply });
  }

  const message = await say("Make next video");
  const started = await startNextItem(thread, message.id, req.nextUrl.origin);
  await addMessage({ conversationId: thread.id, direction: "out", channel: "app", body: started.reply });
  return NextResponse.json({ campaign: await campaignView(thread), queued: started.queued, reply: started.reply });
});
