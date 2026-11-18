/**
 * GET /api/admin/storage            how long raw clips are kept, and the choices
 * PUT /api/admin/storage { retention } change it
 * Platform admin only (lib/media/retention.ts).
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { AccessError, guard, requireUser } from "@/lib/auth/workspace";
import { getRawClipRetention, isRetentionValue, RETENTION_OPTIONS, setRawClipRetention } from "@/lib/media/retention";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireAdmin() {
  const user = await requireUser();
  if (user.role !== "admin") throw new AccessError(403, "Admins only.");
  return user;
}

const answer = async () =>
  NextResponse.json({ retention: await getRawClipRetention(), options: RETENTION_OPTIONS.map(({ value, label }) => ({ value, label })) });

export const GET = guard(async (): Promise<NextResponse> => {
  await requireAdmin();
  return answer();
});

const bodySchema = z.object({ retention: z.string().refine(isRetentionValue, "Pick one of the options.") });

export const PUT = guard(async (req: NextRequest): Promise<NextResponse> => {
  const user = await requireAdmin();
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success || !isRetentionValue(parsed.data.retention)) return NextResponse.json({ error: "Pick one of the options." }, { status: 400 });
  await setRawClipRetention(parsed.data.retention, user.userId);
  return answer();
});
