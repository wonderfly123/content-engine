import { NextResponse } from "next/server";
import { pullAnalyticsNow } from "@/lib/pipelines/analytics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Pulls fresh numbers from Instagram / Facebook for recent posts, on demand. Signed-in users only (middleware). */
export async function POST(): Promise<NextResponse> {
  try {
    return NextResponse.json({ data: await pullAnalyticsNow(), error: null });
  } catch (err) {
    return NextResponse.json({ data: null, error: { message: (err as Error).message } }, { status: 500 });
  }
}
