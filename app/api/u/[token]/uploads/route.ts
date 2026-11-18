/**
 * POST /api/u/[token]/uploads — start uploading one clip, from an upload link (no session: the token in the path is the key;
 * see lib/conversations/upload-link.ts). Same steps as the signed-in route (lib/media/upload-handlers.ts).
 */
import type { NextRequest } from "next/server";
import { withUploadLink } from "@/lib/conversations/upload-link";
import { startUpload } from "@/lib/media/upload-handlers";

export const runtime = "nodejs";

export const POST = withUploadLink(async (req: NextRequest, access, _params) => startUpload(req, access));
