/**
 * GET /api/conversations/[id] — one thread, its messages (oldest first) and its uploaded clips.
 * An editor reply carries its job's cuts (`editor`), and `editor.running` says a job is in flight.
 */
import { NextResponse, type NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { guard } from "@/lib/auth/workspace";
import { requireConversation } from "@/lib/conversations/access";
import { listMessages } from "@/lib/conversations/store";
import { threadEditorView } from "@/lib/editor/view";
import { db, schema } from "@/lib/db";
import { listClips } from "@/lib/media/store";

export const runtime = "nodejs";

export const GET = guard(async (_req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> => {
  const { id } = await ctx.params;
  const { conversation: c, user } = await requireConversation(id);
  const [brand] = c.brandId
    ? await db
        .select({ id: schema.brands.id, name: schema.brands.name })
        .from(schema.brands)
        .where(and(eq(schema.brands.id, c.brandId), eq(schema.brands.workspaceId, c.workspaceId)))
        .limit(1)
    : [];
  const editor = await threadEditorView(c);
  const [messages, clips] = await Promise.all([listMessages(c.id), listClips(c.id, c.workspaceId)]);
  return NextResponse.json({
    conversation: {
      id: c.id,
      kind: c.kind,
      title: c.title,
      description: c.description,
      status: c.status,
      startedVia: c.startedVia,
      closedReason: c.closedReason,
      createdAt: c.createdAt,
      closedAt: c.closedAt,
      mine: c.startedBy === user.userId,
      brand: brand ?? null,
    },
    messages: messages.map((m) => ({
      id: m.id,
      direction: m.direction,
      channel: m.channel,
      body: m.body,
      createdAt: m.createdAt,
      editor: m.editorJobId ? (editor.jobs.get(m.editorJobId) ?? null) : null,
    })),
    clips,
    editor: { running: editor.running },
  });
});
