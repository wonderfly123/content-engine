/**
 * POST /api/u/[token]/uploads/done — report a finished batch to the thread and the editor, from an upload link (no session: the token in the path is the key;
 * see lib/conversations/upload-link.ts). Same steps as the signed-in route (lib/media/upload-handlers.ts).
 */
import type { NextRequest } from "next/server";
import { withUploadLink } from "@/lib/conversations/upload-link";
import { uploadsDone } from "@/lib/media/upload-handlers";

export const runtime = "nodejs";

export const POST = withUploadLink(async (req: NextRequest, access, _params) => uploadsDone(req, access));
