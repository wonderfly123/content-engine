/**
 * POST /api/briefs/batch
 *   Body: { brandId }
 *   Enqueues a `brief_batch` job for the brand.
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { enqueueJob } from "@/lib/pipelines/jobs";
import { getCredential, notConnectedBody } from "@/lib/credentials/store";
import { guard, requireBrand } from "@/lib/auth/workspace";

export const runtime = "nodejs";

const bodySchema = z.object({
  brandId: z.string().uuid(),
});

export const POST = guard(async (req: NextRequest): Promise<NextResponse> => {
  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_body", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const access = await requireBrand(parsed.data.brandId);
  if (!(await getCredential(access.workspaceId, "anthropic"))) {
    return NextResponse.json(notConnectedBody("anthropic"), { status: 409 });
  }
  const jobId = await enqueueJob({
    kind: "brief_batch",
    brandId: access.brandId,
    payload: { source: "manual" },
  });
  return NextResponse.json({ ok: true, jobId }, { status: 202 });
});
