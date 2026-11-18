/**
 * POST /api/editor/progress — the editor worker's steps for one running job (workers/editor on Modal).
 *
 * Public path with no session: the worker signs the raw body (X-Nekter-Signature, HMAC-SHA256 with
 * MODAL_EDITOR_SECRET) and `withEditorSignature` refuses anything else with 403 before any
 * database work. The body names a job and its step labels only (lib/editor/progress.ts).
 */
import { NextResponse } from "next/server";
import { applyEditorProgress } from "@/lib/editor/progress";
import { withEditorSignature } from "@/lib/editor/worker-auth";

export const runtime = "nodejs";

export const POST = withEditorSignature(async (_req, body) => {
  const { status, body: answer } = await applyEditorProgress(body);
  return NextResponse.json(answer, { status });
});
