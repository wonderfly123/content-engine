/**
 * GET  /api/conversations?brandId=   the brand's threads (and the workspace's threads with no brand yet)
 * POST /api/conversations            { brandId, kind } — the New reel / New story buttons
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { guard, requireBrand } from "@/lib/auth/workspace";
import { handleInbound } from "@/lib/conversations/handle";
import { listThreads } from "@/lib/conversations/store";
import { isTextingConfigured } from "@/lib/conversations/twilio";
import { conversationKindValues } from "@/lib/db/enums";

export const runtime = "nodejs";

const createSchema = z.object({ brandId: z.string(), kind: z.enum(conversationKindValues) });

export const GET = guard(async (req: NextRequest): Promise<NextResponse> => {
  const access = await requireBrand(req.nextUrl.searchParams.get("brandId"));
  const threads = await listThreads(access.workspaceId, access.brandId, access.user.userId);
  return NextResponse.json({ threads, textingEnabled: isTextingConfigured() });
});

export const POST = guard(async (req: NextRequest): Promise<NextResponse> => {
  const raw = (await req.json().catch(() => null)) as { brandId?: unknown } | null;
  const access = await requireBrand(raw?.brandId);
  const parsed = createSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "Say reel or story." }, { status: 400 });
  const result = await handleInbound({
    workspaceId: access.workspaceId,
    userId: access.user.userId,
    channel: "app",
    body: parsed.data.kind === "reel" ? "New reel" : "New story",
    brandId: access.brandId,
    origin: req.nextUrl.origin,
  });
  return NextResponse.json(result);
});
