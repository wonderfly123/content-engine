/**
 * POST /api/conversations/[id]/uploads/done { mediaIds } — the browser calls this once after a batch
 * of clips has finished. Posts one message into the thread ("Added 3 clips (1.2 GB)") and hands it
 * to the editor seam (lib/conversations/editor.ts); the editor's answer, if any, is posted after it.
 * Every id must be a clip of this thread (else 404); only the finished ones (ready, or uploaded and being optimized) are counted, at their uploaded size.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { AccessError, guard } from "@/lib/auth/workspace";
import { requireConversation } from "@/lib/conversations/access";
import { handOffToEditor } from "@/lib/conversations/editor";
import { addMessage } from "@/lib/conversations/store";
import { postEditorMessage } from "@/lib/editor/notify";
import { fail, jsonBody, threadClosed } from "@/lib/media/http";
import { clipsAddedMessage, MAX_DONE_IDS } from "@/lib/media/rules";
import { threadMedia } from "@/lib/media/store";

export const runtime = "nodejs";

const bodySchema = z.object({ mediaIds: z.array(z.string().uuid()).min(1).max(MAX_DONE_IDS) });

export const POST = guard(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<Response> => {
  const { id } = await ctx.params;
  const access = await requireConversation(id);
  if (access.conversation.status !== "open") return threadClosed();
  const parsed = bodySchema.safeParse(await jsonBody(req));
  if (!parsed.success) return fail(400, "invalid", "Send the ids of the clips that finished.");
  const ids = [...new Set(parsed.data.mediaIds.map((m) => m.toLowerCase()))];
  const rows = await threadMedia(access.conversation.id, access.workspaceId, ids);
  if (rows.length !== ids.length) throw new AccessError(404, "Not found.");
  const clips = rows.filter((m) => (m.status === "ready" || m.status === "processing") && !m.deletedAt);
  if (clips.length === 0) return fail(400, "no_clips", "None of those clips finished uploading.");

  const total = clips.reduce((sum, c) => sum + (c.originalSizeBytes ?? c.sizeBytes), 0);
  const message = await addMessage({
    conversationId: access.conversation.id,
    direction: "out",
    channel: "app",
    body: clipsAddedMessage(clips.length, total),
  });
  const { queued, reply } = await handOffToEditor(access.conversation.id, message.id, req.nextUrl.origin);
  // The editor's answer ("On it…") goes into the thread like any other reply of its own.
  if (reply) await postEditorMessage(access.conversation, reply);
  return NextResponse.json({ messageId: message.id, count: clips.length, totalBytes: total, editor: { queued } });
});
