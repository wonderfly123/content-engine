/**
 * POST /api/w/[token] { action, ... } — the watch page's buttons (no session: the watch link's
 * token is the key; see lib/conversations/upload-link.ts). Each step is stored in the thread, so the
 * app shows the same history:
 *   { action: "approve" }
 *   { action: "schedule", when: "now" | "tonight" | "tomorrow" | ISO date-time }
 *   { action: "unschedule" }
 *   { action: "changes", body }   -> goes to the editor like a text would
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { handleInbound } from "@/lib/conversations/handle";
import { parsePostTime } from "@/lib/conversations/post-time";
import { addMessage } from "@/lib/conversations/store";
import { withWatchLink } from "@/lib/conversations/upload-link";
import { approveCut, ASK_WHEN, currentCut, scheduleCurrentCut, unscheduleCurrentCut } from "@/lib/editor/approval";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve") }),
  z.object({ action: z.literal("schedule"), when: z.string().trim().min(1).max(40) }),
  z.object({ action: z.literal("unschedule") }),
  z.object({ action: z.literal("changes"), body: z.string().trim().min(1).max(1600) }),
]);

const stage = async (threadId: string) => (await currentCut(threadId))?.stage ?? null;

export const POST = withWatchLink(async (req: NextRequest, access) => {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const thread = access.conversation;
  if (thread.status !== "open") return NextResponse.json({ error: "This video is finished." }, { status: 409 });
  const said = (body: string) => addMessage({ conversationId: thread.id, direction: "in", channel: "sms", body, authorUserId: access.user.userId });
  const answer = (body: string) => addMessage({ conversationId: thread.id, direction: "out", channel: "sms", body });
  const a = parsed.data;

  if (a.action === "approve") {
    if (!(await approveCut(thread.id))) return NextResponse.json({ error: "There's no cut waiting for approval." }, { status: 409 });
    await said("Approved");
    await answer(`Approved. ${ASK_WHEN}`);
  } else if (a.action === "schedule") {
    const iso = /^\d{4}-\d{2}-\d{2}T/.test(a.when) ? new Date(a.when) : null;
    const time = iso && !Number.isNaN(iso.getTime()) ? { when: iso, now: false } : parsePostTime(a.when);
    if (!time) return NextResponse.json({ error: "Pick a time." }, { status: 400 });
    let done;
    try {
      done = await scheduleCurrentCut(access, time.when, time.now);
    } catch (err) {
      return NextResponse.json({ error: `Couldn't schedule it: ${(err as Error).message}` }, { status: 409 });
    }
    if (!done) return NextResponse.json({ error: "There's no cut to schedule." }, { status: 409 });
    await said(time.now ? "Post now" : `Post ${a.when}`);
    await answer(done.line);
    return NextResponse.json({ stage: await stage(thread.id), line: done.line, when: done.when });
  } else if (a.action === "unschedule") {
    if (!(await unscheduleCurrentCut(access))) return NextResponse.json({ error: "It isn't scheduled, or it's already posting." }, { status: 409 });
    await said("Unschedule");
    await answer(`Unscheduled. ${ASK_WHEN}`);
  } else {
    const result = await handleInbound({ workspaceId: access.workspaceId, userId: access.user.userId, channel: "sms", body: a.body, threadId: thread.id });
    return NextResponse.json({ stage: await stage(thread.id), reply: result.reply });
  }
  return NextResponse.json({ stage: await stage(thread.id) });
});
