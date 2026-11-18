/**
 * POST /api/u/[token]/uploads/[mediaId]/abort — cancel a clip still uploading, from an upload link (no session: the token in the path is the key;
 * see lib/conversations/upload-link.ts). Same steps as the signed-in route (lib/media/upload-handlers.ts).
 */
import type { NextRequest } from "next/server";
import { withUploadLink } from "@/lib/conversations/upload-link";
import { abortUpload } from "@/lib/media/upload-handlers";

export const runtime = "nodejs";

export const POST = withUploadLink(async (_req: NextRequest, access, { mediaId }) => abortUpload(access, mediaId));
