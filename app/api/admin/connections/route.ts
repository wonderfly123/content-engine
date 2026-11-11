import { NextResponse } from "next/server";
import { checkConnections, listConnections } from "@/lib/connections/check";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ connections: await listConnections() });
}

/** "Check now" from the Admin page. */
export async function POST(): Promise<NextResponse> {
  return NextResponse.json({ connections: await checkConnections() });
}
