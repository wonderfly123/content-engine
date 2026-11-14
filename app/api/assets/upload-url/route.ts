import { NextResponse, type NextRequest } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { uploadUrlRequestSchema } from "@/lib/assets/types";
import { guard, requireBrand, requireUser } from "@/lib/auth/workspace";

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
export const POST = guard(async (req: NextRequest): Promise<NextResponse> => {
  const body = (await req.json().catch(() => null)) as HandleUploadBody | null;
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  // Leg 2 (`blob.upload-completed`) is called by Vercel Blob, not the browser: it carries no
  // session and is authenticated by the signature `handleUpload` verifies. Everything else is a
  // signed-in caller asking for an upload token, and the brand it names must be theirs.
  if (body.type !== "blob.upload-completed") {
    await requireUser();
    await requireBrand(brandIdOf((body as { payload?: { clientPayload?: unknown } }).payload?.clientPayload));
  }

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
        const { kind, contentType } = parsed.data;
        const { brandId } = await requireBrand(parsed.data.brandId);
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
});

/** The brand id inside the client payload (a JSON string), or undefined when it has none. */
function brandIdOf(clientPayload: unknown): unknown {
  if (typeof clientPayload !== "string") return undefined;
  try {
    return (JSON.parse(clientPayload) as { brandId?: unknown } | null)?.brandId;
  } catch {
    return undefined;
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
