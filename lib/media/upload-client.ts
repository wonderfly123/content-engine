/**
 * The browser side of clip uploads: one file, straight to R2 in parts, through the upload routes.
 *
 *   start (or resume) -> part URLs, 50 at a time -> PUT 4 parts at once, each retried up to 3 times
 *   with backoff -> complete. Progress is the bytes sent so far.
 *
 * Resume: after every part, { mediaId, part size, part count, ETags so far } is kept in localStorage
 * under the thread and the file (name + size + last modified), so picking the same file again after
 * a refresh carries on where it stopped. Browser-only; no server imports.
 */
import { MAX_PART_URLS_PER_CALL } from "./rules";

export const PARALLEL_PARTS = 4;
export const PART_RETRIES = 3;

export interface ResumeEntry {
  mediaId: string;
  partSize: number;
  partCount: number;
  etags: Record<number, string>;
  savedAt: number;
}

export class UploadError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "UploadError";
  }
}

export class UploadCancelled extends Error {
  constructor() {
    super("Cancelled.");
    this.name = "UploadCancelled";
  }
}

export const fingerprint = (file: File) => `${file.name}|${file.size}|${file.lastModified}`;
const PREFIX = "nekter.clip-upload.";
const storageKey = (conversationId: string, file: File) => `${PREFIX}${conversationId}.${fingerprint(file)}`;

/** Saved progress per thread and file. Storage can be missing or blocked, so every call is guarded. */
export const resumeStore = {
  get(conversationId: string, file: File): ResumeEntry | null {
    try {
      const raw = window.localStorage.getItem(storageKey(conversationId, file));
      if (!raw) return null;
      const e = JSON.parse(raw) as ResumeEntry;
      if (typeof e?.mediaId !== "string" || !(e.partSize > 0) || !(e.partCount > 0) || typeof e.etags !== "object") return null;
      return e;
    } catch {
      return null;
    }
  },
  set(conversationId: string, file: File, entry: ResumeEntry): void {
    try {
      window.localStorage.setItem(storageKey(conversationId, file), JSON.stringify({ ...entry, savedAt: Date.now() }));
    } catch {
      /* no storage: the upload still works, it just cannot resume */
    }
  },
  clear(conversationId: string, file: File): void {
    try {
      window.localStorage.removeItem(storageKey(conversationId, file));
    } catch {
      /* ignore */
    }
  },
  /** How many unfinished uploads are saved for this thread. */
  count(conversationId: string): number {
    try {
      let n = 0;
      for (let i = 0; i < window.localStorage.length; i++) if (window.localStorage.key(i)?.startsWith(`${PREFIX}${conversationId}.`)) n++;
      return n;
    } catch {
      return 0;
    }
  },
};

/**
 * `retries`: how many more times to try when the request never got an answer (the phone dropped the
 * connection, "Load failed"). Only for calls that are safe to repeat: part URLs and complete.
 */
async function api<T>(url: string, body: unknown, signal?: AbortSignal, retries = 0): Promise<T> {
  let res: Response;
  for (let attempt = 0; ; attempt++) {
    try {
      res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}), signal });
      break;
    } catch {
      if (signal?.aborted) throw new UploadCancelled();
      if (attempt >= retries) throw new UploadError("The connection dropped. Tap retry to carry on where it stopped.");
      await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt)); // 1 s, 2 s, 4 s
    }
  }
  const json = (await res.json().catch(() => ({}))) as T & { message?: string; error?: string };
  if (!res.ok) throw new UploadError(json.message ?? json.error ?? `HTTP ${res.status}`, res.status);
  return json;
}

/** PUT one part to its presigned URL; resolves with the ETag R2 returns. */
function putPart(url: string, blob: Blob, signal: AbortSignal, onProgress: (loaded: number) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new UploadCancelled());
    const xhr = new XMLHttpRequest();
    const onAbort = () => xhr.abort();
    signal.addEventListener("abort", onAbort, { once: true });
    xhr.open("PUT", url);
    xhr.upload.onprogress = (e) => onProgress(e.loaded);
    xhr.onload = () => {
      const etag = xhr.getResponseHeader("ETag");
      if (xhr.status >= 200 && xhr.status < 300) {
        if (etag) resolve(etag);
        else reject(new UploadError("Storage did not return the part's ETag."));
      } else reject(new UploadError(`A part failed to upload (${xhr.status}).`, xhr.status));
    };
    xhr.onerror = () => reject(new UploadError("Network error while uploading."));
    xhr.onabort = () => reject(new UploadCancelled());
    xhr.onloadend = () => signal.removeEventListener("abort", onAbort);
    xhr.send(blob);
  });
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(t), reject(new UploadCancelled())), { once: true });
  });

/** The server refused (gone, not uploading, closed, not set up): retrying a part will not help. */
const isFinal = (err: unknown) => err instanceof UploadError && [400, 404, 409, 413, 415, 422, 503].includes(err.status ?? 0);

/** The signed-in upload routes for a thread; an upload link uses /api/u/<token>/uploads instead. */
export const uploadsBase = (conversationId: string) => `/api/conversations/${conversationId}/uploads`;

export interface UploadOptions {
  conversationId: string;
  /** Where the upload routes live (default: the signed-in ones for the thread). */
  base?: string;
  file: File;
  resume?: ResumeEntry | null;
  signal: AbortSignal;
  onProgress: (uploadedBytes: number) => void;
  onStarted?: (mediaId: string) => void;
}

/** Uploads one clip; resolves with its media id once it is complete and checked. */
export async function uploadClip(o: UploadOptions): Promise<string> {
  if (!o.resume) return run(o, null);
  try {
    return await run(o, o.resume);
  } catch (err) {
    // The saved upload is gone or finished elsewhere: start this file again from the beginning.
    if (err instanceof UploadError && (err.status === 404 || err.status === 409)) {
      resumeStore.clear(o.conversationId, o.file);
      return run(o, null);
    }
    throw err;
  }
}

async function run(o: UploadOptions, resume: ResumeEntry | null): Promise<string> {
  const { conversationId, file } = o;
  const base = o.base ?? uploadsBase(conversationId);
  const ctrl = new AbortController();
  const signal = ctrl.signal;
  if (o.signal.aborted) throw new UploadCancelled();
  o.signal.addEventListener("abort", () => ctrl.abort(), { once: true });

  const entry: ResumeEntry =
    resume ??
    ({ ...(await api<{ mediaId: string; partSize: number; partCount: number }>(base, { filename: file.name, size: file.size, contentType: file.type }, signal)), etags: {}, savedAt: Date.now() });
  resumeStore.set(conversationId, file, entry);
  o.onStarted?.(entry.mediaId);
  const { mediaId, partSize, partCount } = entry;
  const partBytes = (n: number) => Math.min(partSize, file.size - (n - 1) * partSize);

  let doneBytes = Object.keys(entry.etags).reduce((sum, n) => sum + partBytes(Number(n)), 0);
  const inflight = new Map<number, number>();
  const report = () => o.onProgress(doneBytes + [...inflight.values()].reduce((a, b) => a + b, 0));
  report();

  const todo = Array.from({ length: partCount }, (_, i) => i + 1).filter((n) => !entry.etags[n]);
  const urls = new Map<number, string>();
  let fetching: Promise<void> | null = null;
  const urlFor = async (n: number): Promise<string> => {
    while (!urls.has(n)) {
      if (!fetching) {
        const from = todo.indexOf(n);
        const batch = todo.slice(from, from + MAX_PART_URLS_PER_CALL).filter((x) => !entry.etags[x] && !urls.has(x));
        fetching = api<{ urls: Array<{ partNumber: number; url: string }> }>(`${base}/${mediaId}/parts`, { partNumbers: batch }, signal, PART_RETRIES)
          .then((r) => r.urls.forEach((u) => urls.set(u.partNumber, u.url)))
          .finally(() => (fetching = null));
      }
      await fetching;
    }
    const url = urls.get(n)!;
    urls.delete(n); // used once: a retry asks for a fresh URL
    return url;
  };

  let next = 0;
  const worker = async () => {
    while (next < todo.length) {
      const n = todo[next++];
      const blob = file.slice((n - 1) * partSize, (n - 1) * partSize + partBytes(n));
      for (let attempt = 0; ; attempt++) {
        try {
          const etag = await putPart(await urlFor(n), blob, signal, (loaded) => (inflight.set(n, loaded), report()));
          inflight.delete(n);
          entry.etags[n] = etag;
          doneBytes += blob.size;
          resumeStore.set(conversationId, file, entry);
          report();
          break;
        } catch (err) {
          inflight.delete(n);
          report();
          if (signal.aborted || err instanceof UploadCancelled) throw new UploadCancelled();
          if (isFinal(err) || attempt >= PART_RETRIES) throw err;
          await sleep(1000 * 2 ** attempt, signal); // 1 s, 2 s, 4 s
        }
      }
    }
  };

  try {
    await Promise.all(Array.from({ length: Math.min(PARALLEL_PARTS, todo.length) }, worker));
  } catch (err) {
    ctrl.abort(); // stop the other parts
    throw o.signal.aborted ? new UploadCancelled() : err;
  }

  const parts = Object.entries(entry.etags).map(([n, etag]) => ({ partNumber: Number(n), etag }));
  try {
    await api(`${base}/${mediaId}/complete`, { parts }, signal, PART_RETRIES);
  } catch (err) {
    if (isFinal(err)) resumeStore.clear(conversationId, file);
    throw err;
  }
  resumeStore.clear(conversationId, file);
  return mediaId;
}

/** Cancels a clip on the server (best effort). */
export async function abortClip(conversationId: string, mediaId: string, base = uploadsBase(conversationId)): Promise<void> {
  await fetch(`${base}/${mediaId}/abort`, { method: "POST" }).catch(() => undefined);
}

/** After a batch: one message in the thread, and the hand-off to the editor. */
export async function reportBatchDone(
  conversationId: string,
  mediaIds: string[],
  base = uploadsBase(conversationId),
  extra: { description?: string; seconds?: 15 | 30 | 60 } = {},
): Promise<void> {
  await api(`${base}/done`, { mediaIds, ...extra });
}
