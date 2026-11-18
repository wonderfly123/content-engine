/**
 * POST /api/media/frames — the frames worker's callback (workers/optimize/app.py `frames`).
 *
 * Public path with no session: the worker signs the raw body (X-Nekter-Signature, HMAC-SHA256 with
 * MODAL_OPTIMIZE_SECRET) and `withWorkerSignature` refuses anything else with 403 before any
 * database work. The body only names a job and an asset; storage keys are derived from the row.
 */
import { NextResponse } from "next/server";
import { applyFramesResult } from "@/lib/media/describe";
import { withStorage } from "@/lib/media/http";
import { withWorkerSignature } from "@/lib/media/worker-signature";

export const runtime = "nodejs";
// Claude looks at the contact sheet inside this request.
export const maxDuration = 120;

export const POST = withWorkerSignature(async (_req, body) =>
  withStorage(async () => {
    const { status, body: answer } = await applyFramesResult(body);
    return NextResponse.json(answer, { status });
  }),
);
