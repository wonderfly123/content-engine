/**
 * The thread's cut and its schedule, for the app's thread view (lib/editor/approval.ts):
 *   GET    -> { stage, when }   stage: ready | approved | scheduled | posted, or null with no cut
 *   POST   { when: "now" | "tonight" | ISO date-time } -> schedules it (approving it first if needed)
 *   DELETE -> unschedules it
 * Each step is posted in the thread, so texts and the app show the same history.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { guard } from "@/lib/auth/workspace";
import { requireConversation } from "@/lib/conversations/access";
import { parsePostTime } from "@/lib/conversations/post-time";
import { addMessage } from "@/lib/conversations/store";
import { ASK_WHEN, currentCut, scheduleCurrentCut, unscheduleCurrentCut } from "@/lib/editor/approval";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const view = async (threadId: string) => {
  const c = await currentCut(threadId);
  return { stage: c?.stage ?? null, when: c?.post?.when ?? null };
};

export const GET = guard(async (_req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> => {
  const { id } = await ctx.params;
  const { conversation } = await requireConversation(id);
  return NextResponse.json(await view(conversation.id));
});

const bodySchema = z.object({ when: z.string().trim().min(1).max(40) });

export const POST = guard(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> => {
  const { id } = await ctx.params;
  const access = await requireConversation(id);
  if (access.conversation.status !== "open") return NextResponse.json({ error: "This conversation is closed." }, { status: 409 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Pick a time." }, { status: 400 });
  const raw = parsed.data.when;
  const iso = /^\d{4}-\d{2}-\d{2}T/.test(raw) ? new Date(raw) : null;
  const time = iso && !Number.isNaN(iso.getTime()) ? { when: iso, now: false } : parsePostTime(raw);
  if (!time) return NextResponse.json({ error: "Pick a time." }, { status: 400 });
  let done;
  try {
    done = await scheduleCurrentCut(access, time.when, time.now);
  } catch (err) {
    return NextResponse.json({ error: `Couldn't schedule it: ${(err as Error).message}` }, { status: 409 });
  }
  if (!done) return NextResponse.json({ error: "There's no cut to schedule." }, { status: 409 });
  await addMessage({ conversationId: access.conversation.id, direction: "in", channel: "app", body: time.now ? "Post now" : `Post ${raw}`, authorUserId: access.user.userId });
  await addMessage({ conversationId: access.conversation.id, direction: "out", channel: "app", body: done.line });
  return NextResponse.json(await view(access.conversation.id));
});

export const DELETE = guard(async (_req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> => {
  const { id } = await ctx.params;
  const access = await requireConversation(id);
  if (!(await unscheduleCurrentCut(access))) return NextResponse.json({ error: "It isn't scheduled, or it's already posting." }, { status: 409 });
  await addMessage({ conversationId: access.conversation.id, direction: "in", channel: "app", body: "Unschedule", authorUserId: access.user.userId });
  await addMessage({ conversationId: access.conversation.id, direction: "out", channel: "app", body: `Unscheduled. ${ASK_WHEN}` });
  return NextResponse.json(await view(access.conversation.id));
});
