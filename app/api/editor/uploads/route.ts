/**
 * POST /api/editor/uploads?job=<jobId> { files: [{ name, contentType }] } — upload links for the
 * editor worker's previews (workers/editor on Modal).
 *
 * Public path with no session: the worker sends `Authorization: Bearer <MODAL_EDITOR_SECRET>` and
 * `withEditorBearer` refuses anything else with 403 before any database work. Only a running job
 * gets links, and the keys are derived from that job, under its own thread (lib/editor/uploads.ts).
 */
import { NextResponse } from "next/server";
import { withEditorBearer } from "@/lib/editor/worker-auth";
import { issueUploadUrls } from "@/lib/editor/uploads";
import { withStorage } from "@/lib/media/http";

export const runtime = "nodejs";

export const POST = withEditorBearer(async (req, body) =>
  withStorage(async () => {
    const { status, body: answer } = await issueUploadUrls(req.nextUrl.searchParams.get("job"), body);
    return NextResponse.json(answer, { status });
  }),
);
