/**
 * POST /api/media/optimized — the optimizer worker's callback (workers/optimize/app.py).
 *
 * Public path with no session: the worker signs the raw body (X-Nekter-Signature, HMAC-SHA256 with
 * MODAL_OPTIMIZE_SECRET) and `withWorkerSignature` refuses anything else with 403 before any
 * database work. The body only names a job and a clip; the storage key is derived from the row.
 * Storage errors answer 5xx so the worker tries again; everything else is final.
 */
import { NextResponse } from "next/server";
import { withStorage } from "@/lib/media/http";
import { applyOptimizeResult } from "@/lib/media/optimize";
import { withWorkerSignature } from "@/lib/media/worker-signature";

export const runtime = "nodejs";

export const POST = withWorkerSignature(async (_req, body) =>
  withStorage(async () => {
    const { status, body: answer } = await applyOptimizeResult(body);
    return NextResponse.json(answer, { status });
  }),
);
