/**
 * Upload rules shared by the server routes and the browser uploader (no server imports here).
 */

/** Largest single clip. */
export const MAX_FILE_BYTES = 10 * 1024 ** 3;
/** Default multipart part size; raised when a file would need more than MAX_PARTS parts. */
export const PART_SIZE = 16 * 1024 ** 2;
export const MAX_PARTS = 10_000;
/** Presigned part URLs handed out per call. */
export const MAX_PART_URLS_PER_CALL = 50;
/** Media ids reported in one "done" call. */
export const MAX_DONE_IDS = 200;

/** A batch this big takes a while to shrink before the editor can start; the person is told to expect a wait. */
export const LARGE_BATCH_BYTES = 200 * 1024 ** 2;
/** Said after a large batch is sent (measured: a 489 MB clip took about 12 minutes to prepare). */
export const LARGE_BATCH_NOTE = "Large clips take 10 to 15 minutes to prepare before editing starts, so the first cut will take longer.";

const VIDEO_EXTENSIONS = /\.(mov|mp4|m4v)$/i;

/** A video by its type (`video/*`), or by name (.mov / .mp4 / .m4v) when the browser sends no useful type. */
export function isVideoFile(filename: string, contentType: string | null | undefined): boolean {
  const type = (contentType ?? "").trim().toLowerCase();
  if (/^video\/[a-z0-9.+-]+$/.test(type)) return true;
  return VIDEO_EXTENSIONS.test(filename);
}

/** The content type to store: the browser's when it is a video type, else one from the extension. */
export function videoContentType(filename: string, contentType: string | null | undefined): string {
  const type = (contentType ?? "").trim().toLowerCase();
  if (/^video\/[a-z0-9.+-]+$/.test(type)) return type;
  if (/\.mov$/i.test(filename)) return "video/quicktime";
  if (/\.m4v$/i.test(filename)) return "video/x-m4v";
  return "video/mp4";
}

export interface PartPlan {
  partSize: number;
  partCount: number;
}

/** 16 MB parts, raised to the next whole MB when that would mean more than 10,000 parts. */
export function planParts(size: number): PartPlan {
  if (!Number.isSafeInteger(size) || size <= 0) throw new RangeError("size must be a positive integer");
  let partSize = PART_SIZE;
  if (Math.ceil(size / partSize) > MAX_PARTS) partSize = Math.ceil(size / MAX_PARTS / 1024 ** 2) * 1024 ** 2;
  return { partSize, partCount: Math.ceil(size / partSize) };
}

/** "350 MB", "1.2 GB". */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

/** The person's message for a batch of clips: it starts with "Added 3 clips (1.2 GB)". */
export const isClipsMessage = (body: string) => /^Added \d+ clips? \(/.test(body);

/** The thread message after a batch: "Added 3 clips (1.2 GB)". */
export function clipsAddedMessage(count: number, totalBytes: number): string {
  return `Added ${count} ${count === 1 ? "clip" : "clips"} (${formatBytes(totalBytes)})`;
}
