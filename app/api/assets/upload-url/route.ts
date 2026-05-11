import { NextResponse, type NextRequest } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { uploadUrlRequestSchema } from "@/lib/assets/types";

export const runtime = "nodejs";

/**
 * POST /api/assets/upload-url
 *
 * Implements the Vercel Blob client-upload handshake. The browser
 * sends two kinds of requests through this same endpoint:
 *
 *   1) `{type:'blob.generate-client-token', payload:{ pathname, clientPayload }}`
 *      — we authorize the upload and return a short-lived client token.
 *   2) `{type:'blob.upload-completed', payload:{ blob, tokenPayload }}`
 *      — fired by Vercel Blob after the direct PUT completes.
 *
 * The browser library `@vercel/blob/client.upload()` orchestrates both legs.
 * `clientPayload` carries the JSON-encoded {brandId, kind, filename, contentType}
 * we validate before issuing a token.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json()) as HandleUploadBody;

  try {
    const json = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const parsed = uploadUrlRequestSchema.safeParse(
          clientPayload ? JSON.parse(clientPayload) : {},
        );
        if (!parsed.success) {
          throw new Error(`invalid clientPayload: ${parsed.error.message}`);
        }
        const { brandId, kind, contentType } = parsed.data;
        return {
          // Restrict accepted content types to the kind requested
          allowedContentTypes: allowedContentTypesFor(kind, contentType),
          // Stash the validated metadata in the token; the client echoes it back.
          tokenPayload: JSON.stringify({ brandId, kind, pathname }),
          addRandomSuffix: true,
          maximumSizeInBytes: 100 * 1024 * 1024,
        };
      },
      onUploadCompleted: async () => {
        // No-op; the client follows up with POST /api/assets which performs
        // server-side validation against the blob.
      },
    });
    return NextResponse.json(json);
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 400 },
    );
  }
}

function allowedContentTypesFor(
  kind: "video" | "image" | "audio" | "graphic",
  hinted: string,
): string[] {
  switch (kind) {
    case "video":
      return ["video/mp4", "video/quicktime", "video/webm"];
    case "image":
      return ["image/jpeg", "image/png"];
    case "audio":
      return ["audio/mpeg", "audio/mp4", "audio/wav", "audio/webm"];
    case "graphic":
      // graphic is loose — accept the hint plus common formats
      return Array.from(
        new Set([
          hinted,
          "image/jpeg",
          "image/png",
          "image/svg+xml",
          "image/webp",
        ]),
      );
  }
}
