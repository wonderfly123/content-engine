/**
 * POST /api/editor/callback — the editor worker's result for one job (workers/editor on Modal).
 *
 * Public path with no session: the worker signs the raw body (X-Nekter-Signature, HMAC-SHA256 with
 * MODAL_EDITOR_SECRET) and `withEditorSignature` refuses anything else with 403 before any
 * database work. The body names a job; every key and clip in it is checked against that job's own
 * thread (lib/editor/callback.ts). Storage errors answer 5xx so the worker tries again.
 */
import { NextResponse } from "next/server";
import { applyEditorResult } from "@/lib/editor/callback";
import { withEditorSignature } from "@/lib/editor/worker-auth";
import { withStorage } from "@/lib/media/http";

export const runtime = "nodejs";

export const POST = withEditorSignature(async (_req, body) =>
  withStorage(async () => {
    const { status, body: answer } = await applyEditorResult(body);
    return NextResponse.json(answer, { status });
  }),
);
