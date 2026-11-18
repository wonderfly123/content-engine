/**
 * POST /api/conversations/[id]/messages { body } — a message typed in the app. Same routing rules
 * as a text; the reply comes back in the app (never by text). A campaign chat has its own rules
 * (lib/campaigns/chat.ts), and its brainstorm is a Claude call that can take a minute.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { guard } from "@/lib/auth/workspace";
import { handleCampaignMessage } from "@/lib/campaigns/chat";
import { requireConversation } from "@/lib/conversations/access";
import { handleInbound, MAX_BODY_CHARS, ThreadClosedError } from "@/lib/conversations/handle";

export const runtime = "nodejs";
export const maxDuration = 300;

const bodySchema = z.object({ body: z.string().trim().min(1, "Type a message.").max(MAX_BODY_CHARS) });

export const POST = guard(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> => {
  const { id } = await ctx.params;
  const access = await requireConversation(id);
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid message." }, { status: 400 });
  if (access.conversation.kind === "campaign") {
    if (access.conversation.status !== "open") return NextResponse.json({ error: new ThreadClosedError().message }, { status: 409 });
    return NextResponse.json(await handleCampaignMessage({ access, body: parsed.data.body, origin: req.nextUrl.origin }));
  }
  try {
    const result = await handleInbound({
      workspaceId: access.workspaceId,
      userId: access.user.userId,
      channel: "app",
      body: parsed.data.body,
      threadId: access.conversation.id,
      origin: req.nextUrl.origin,
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ThreadClosedError) return NextResponse.json({ error: err.message }, { status: 409 });
    throw err;
  }
});
