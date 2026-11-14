import { NextResponse } from "next/server";
import { AccessError, guard, requireUser } from "@/lib/auth/workspace";
import { checkConnections, listConnections } from "@/lib/connections/check";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = guard(async (): Promise<NextResponse> => {
  if ((await requireUser()).role !== "admin") throw new AccessError(403, "Admins only.");
  return NextResponse.json({ connections: await listConnections() });
});

/** "Check now" from the Admin page. */
export const POST = guard(async (): Promise<NextResponse> => {
  if ((await requireUser()).role !== "admin") throw new AccessError(403, "Admins only.");
  return NextResponse.json({ connections: await checkConnections() });
});
