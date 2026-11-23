"use client";

/**
 * The upload queue for one thread: files go one at a time (each with 4 parts in flight), and once
 * the queue is idle the finished clips are reported together, so the thread gets one message.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { formatBytes, isVideoFile, MAX_FILE_BYTES } from "@/lib/media/rules";
import { abortClip, fingerprint, reportBatchDone, resumeStore, uploadClip, type ResumeEntry } from "@/lib/media/upload-client";

export type UploadStatus = "resumable" | "queued" | "uploading" | "done" | "failed" | "cancelled";

export interface UploadItem {
  id: string;
  file: File;
  status: UploadStatus;
  uploaded: number;
  error?: string;
  mediaId?: string;
  resume: ResumeEntry | null;
}

const ACTIVE: UploadStatus[] = ["resumable", "queued", "uploading"];
let seq = 0;

/** `base`: where the upload routes live (an upload link's /api/u/<token>/uploads); default, the signed-in ones. */
export function useClipUploads(conversationId: string, onChange: () => void, base?: string, opts: { autoReport?: boolean } = {}) {
  const autoReport = opts.autoReport ?? true;
  const [items, setItems] = useState<UploadItem[]>([]);
  const [leftover, setLeftover] = useState(0);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const controllers = useRef(new Map<string, AbortController>());
  const finished = useRef<string[]>([]);
  const running = useRef(false);
  const lastTick = useRef(new Map<string, number>());
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => setLeftover(resumeStore.count(conversationId)), [conversationId]);

  const patch = useCallback((id: string, p: Partial<UploadItem>) => setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...p } : i))), []);

  const addFiles = useCallback(
    (files: File[]) => {
      const notVideo = files.filter((f) => !isVideoFile(f.name, f.type));
      const tooBig = files.filter((f) => isVideoFile(f.name, f.type) && f.size > MAX_FILE_BYTES);
      if (notVideo.length) toast.error(`${notVideo.map((f) => f.name).join(", ")}: not a video. Add .mov, .mp4 or .m4v clips.`);
      if (tooBig.length) toast.error(`${tooBig.map((f) => f.name).join(", ")}: over ${formatBytes(MAX_FILE_BYTES)}.`);
      const empty = files.filter((f) => isVideoFile(f.name, f.type) && f.size === 0);
      if (empty.length) toast.error(`${empty.map((f) => f.name).join(", ")}: came through empty. Pick it again.`);
      const ok = files.filter((f) => isVideoFile(f.name, f.type) && f.size > 0 && f.size <= MAX_FILE_BYTES);
      setItems((prev) => {
        const busy = new Set(prev.filter((i) => ACTIVE.includes(i.status)).map((i) => fingerprint(i.file)));
        const fresh = ok
          .filter((f) => !busy.has(fingerprint(f)))
          .map((file): UploadItem => {
            const resume = resumeStore.get(conversationId, file);
            const saved = resume ? Math.min(file.size, Object.keys(resume.etags).length * resume.partSize) : 0;
            return { id: `u${++seq}`, file, status: resume ? "resumable" : "queued", uploaded: saved, resume };
          });
        return [...prev, ...fresh];
      });
    },
    [conversationId],
  );

  const run = useCallback(
    async (item: UploadItem) => {
      const ctrl = new AbortController();
      controllers.current.set(item.id, ctrl);
      patch(item.id, { status: "uploading", error: undefined });
      try {
        const mediaId = await uploadClip({
          conversationId,
          base,
          file: item.file,
          resume: item.resume,
          signal: ctrl.signal,
          onStarted: (id) => patch(item.id, { mediaId: id }),
          onProgress: (bytes) => {
            const now = Date.now();
            if (now - (lastTick.current.get(item.id) ?? 0) < 150) return;
            lastTick.current.set(item.id, now);
            patch(item.id, { uploaded: bytes });
          },
        });
        finished.current.push(mediaId);
        patch(item.id, { status: "done", uploaded: item.file.size, resume: null });
        onChangeRef.current();
      } catch (err) {
        if (ctrl.signal.aborted) patch(item.id, { status: "cancelled" });
        else patch(item.id, { status: "failed", error: (err as Error).message });
      } finally {
        controllers.current.delete(item.id);
        running.current = false;
        setItems((prev) => [...prev]); // run the queue again
      }
    },
    [conversationId, base, patch],
  );

  // One file at a time; when nothing is left to do, report the finished batch once.
  useEffect(() => {
    if (running.current) return;
    const next = items.find((i) => i.status === "queued");
    if (next) {
      running.current = true;
      void run(next);
      return;
    }
    if (!autoReport || items.some((i) => ACTIVE.includes(i.status)) || finished.current.length === 0) return;
    const ids = finished.current;
    finished.current = [];
    reportBatchDone(conversationId, ids, base)
      .then(() => onChangeRef.current())
      .catch((err: Error) => toast.error(`Clips uploaded, but the thread was not told: ${err.message}`));
    setLeftover(resumeStore.count(conversationId));
  }, [items, run, conversationId, base, autoReport]);

  /** Without autoReport: tells the thread about every clip finished so far, with what it's about. */
  const report = useCallback(
    async (extra: { description?: string; seconds?: 15 | 30 | 60 }) => {
      const ids = finished.current;
      if (ids.length === 0) return;
      await reportBatchDone(conversationId, ids, base, extra);
      finished.current = [];
      onChangeRef.current();
    },
    [conversationId, base],
  );

  const uploading = items.some((i) => i.status === "uploading" || i.status === "queued");

  // Leaving the page mid-upload loses the parts in flight; ask first.
  useEffect(() => {
    if (!uploading) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [uploading]);

  // Closing the panel stops the transfers but keeps the saved progress, so they can be resumed.
  useEffect(() => {
    const map = controllers.current;
    return () => map.forEach((c) => c.abort());
  }, []);

  const cancel = useCallback(
    (id: string) => {
      const item = itemsRef.current.find((i) => i.id === id);
      if (!item) return;
      controllers.current.get(id)?.abort();
      const mediaId = item.mediaId ?? item.resume?.mediaId;
      if (mediaId) void abortClip(conversationId, mediaId, base).then(() => onChangeRef.current());
      resumeStore.clear(conversationId, item.file);
      patch(id, { status: "cancelled", resume: null });
    },
    [conversationId, patch],
  );

  const resume = useCallback((id: string) => patch(id, { status: "queued" }), [patch]);

  const startOver = useCallback(
    (id: string) => {
      const item = itemsRef.current.find((i) => i.id === id);
      if (!item) return;
      if (item.resume) void abortClip(conversationId, item.resume.mediaId, base);
      resumeStore.clear(conversationId, item.file);
      patch(id, { status: "queued", resume: null, uploaded: 0 });
    },
    [conversationId, patch],
  );

  /** A failed file tries again, carrying on from the parts already saved. */
  const retry = useCallback(
    (id: string) => {
      const item = itemsRef.current.find((i) => i.id === id);
      if (item) patch(id, { status: "queued", error: undefined, resume: resumeStore.get(conversationId, item.file) });
    },
    [conversationId, patch],
  );

  const clearFinished = useCallback(() => setItems((prev) => prev.filter((i) => ACTIVE.includes(i.status))), []);

  const counted = items.filter((i) => i.status !== "cancelled");
  const totalBytes = counted.reduce((s, i) => s + i.file.size, 0);
  const sentBytes = counted.reduce((s, i) => s + (i.status === "done" ? i.file.size : i.uploaded), 0);

  return { items, leftover, uploading, totalBytes, sentBytes, addFiles, cancel, resume, startOver, retry, clearFinished, report };
}
