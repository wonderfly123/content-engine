import sharp from "sharp";
import { put } from "@vercel/blob";

export interface ThumbnailResult {
  url: string | null;
  /** Reason if no thumbnail was produced */
  note?: string;
}

/**
 * Generate a thumbnail for an image asset.
 * Downloads the source blob, resizes to a 256×256 cover JPEG, and uploads
 * back to Vercel Blob with a `_thumb.jpg` suffix.
 *
 * For videos we return { url: null, note } — Vercel's runtime does not
 * ship `ffmpeg`, and the in-scope dependency `@ffprobe-installer/ffprobe`
 * is read-only metadata. UI uses a placeholder kind-icon.
 */
export async function generateThumbnail(
  blobUrl: string,
  kind: "image" | "video" | "audio" | "graphic",
): Promise<ThumbnailResult> {
  if (kind === "video") {
    return {
      url: null,
      note: "video-thumbnail-deferred: ffmpeg not available in Vercel runtime",
    };
  }
  if (kind === "audio") {
    return { url: null, note: "no-thumbnail-for-audio" };
  }
  // image | graphic — sharp can also handle SVG and similar via libvips
  try {
    const res = await fetch(blobUrl);
    if (!res.ok) {
      return {
        url: null,
        note: `fetch-failed: ${res.status} ${res.statusText}`,
      };
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const thumb = await sharp(buf)
      .resize(256, 256, { fit: "cover" })
      .jpeg({ quality: 80 })
      .toBuffer();

    const thumbPath = deriveThumbPath(blobUrl);
    const result = await put(thumbPath, thumb, {
      access: "public",
      contentType: "image/jpeg",
      addRandomSuffix: false,
    });
    return { url: result.url };
  } catch (e) {
    return {
      url: null,
      note: `thumb-error: ${(e as Error).message}`,
    };
  }
}

function deriveThumbPath(blobUrl: string): string {
  try {
    const u = new URL(blobUrl);
    // strip query, leading slash; replace extension with _thumb.jpg
    const pathname = u.pathname.replace(/^\//, "");
    const dot = pathname.lastIndexOf(".");
    const base = dot === -1 ? pathname : pathname.slice(0, dot);
    return `${base}_thumb.jpg`;
  } catch {
    return `thumbs/${Date.now()}_thumb.jpg`;
  }
}
