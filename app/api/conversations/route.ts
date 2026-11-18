/**
 * GET  /api/conversations?brandId=   the brand's threads (and the workspace's threads with no brand yet),
 *                                    plus whether texting is on and the caller's number texts for this brand
 * POST /api/conversations            { brandId, kind } — the New reel / New story / New campaign buttons
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { guard, requireBrand } from "@/lib/auth/workspace";
import { CAMPAIGN_OPENER, createCampaign } from "@/lib/campaigns/chat";
import { handleInbound } from "@/lib/conversations/handle";
import { formatPhone } from "@/lib/conversations/phone";
import { phoneOnForBrand } from "@/lib/conversations/phones";
import { listThreads } from "@/lib/conversations/store";
import { isTextingConfigured, salesmsgConfig } from "@/lib/conversations/texting";
import { conversationKindValues } from "@/lib/db/enums";

export const runtime = "nodejs";

const createSchema = z.object({ brandId: z.string(), kind: z.enum(conversationKindValues) });

export const GET = guard(async (req: NextRequest): Promise<NextResponse> => {
  const access = await requireBrand(req.nextUrl.searchParams.get("brandId"));
  const threads = await listThreads(access.workspaceId, access.brandId, access.user.userId);
  const ours = salesmsgConfig()?.phoneNumber;
  return NextResponse.json({
    threads,
    textingEnabled: isTextingConfigured(),
    phoneConfirmed: await phoneOnForBrand(access.user.userId, access.brandId),
    textingNumber: ours ? formatPhone(ours) : null,
  });
});

export const POST = guard(async (req: NextRequest): Promise<NextResponse> => {
  const raw = (await req.json().catch(() => null)) as { brandId?: unknown } | null;
  const access = await requireBrand(raw?.brandId);
  const parsed = createSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "Say reel, story or campaign." }, { status: 400 });
  if (parsed.data.kind === "campaign") {
    // One chat that plans and makes many videos (lib/campaigns): app only, starts with the editor's question.
    const thread = await createCampaign({ workspaceId: access.workspaceId, userId: access.user.userId, brandId: access.brandId });
    return NextResponse.json({ conversationId: thread.id, reply: CAMPAIGN_OPENER });
  }
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
