/**
 * POST /api/briefs/[id]/approve
 *
 * Transitions the brief to 'approved' and triggers draft generation
 * (event-driven per spec Section 6 — not queued).
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { approveBriefAndGenerateDraft } from "@/lib/pipelines/drafts";

export const runtime = "nodejs";

const idSchema = z.string().uuid();

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await ctx.params;
  if (!idSchema.safeParse(id).success) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }
  try {
    const result = await approveBriefAndGenerateDraft(id, { actor: "user" });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { error: "approve_failed", detail: (err as Error).message },
      { status: 422 },
    );
  }
}
