/**
 * Assets kept on our private R2 bucket are stored as r2://<key> (uploaded clips, their thumbnails).
 * A browser cannot open those, so every asset sent to the app has them swapped for short-lived
 * links. The stored row keeps r2:// (publishing resolves it again when it posts).
 */
import { R2_URI_PREFIX, resolveStorageUrl } from "@/lib/storage/r2";

const VIEW_SECONDS = 6 * 60 * 60;

const viewUrl = (url: string | null): string | null => (url && url.startsWith(R2_URI_PREFIX) ? resolveStorageUrl(url, VIEW_SECONDS) : url);

export function viewable<T extends { storageUrl: string; thumbnailUrl: string | null }>(row: T): T {
  return { ...row, storageUrl: viewUrl(row.storageUrl) ?? row.storageUrl, thumbnailUrl: viewUrl(row.thumbnailUrl) };
}
