"use client";

import { useCallback, useRef, useState } from "react";
import { upload } from "@vercel/blob/client";
import { UploadCloud, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AssetKind } from "@/lib/db/enums";

interface Props {
  brandId: string;
  draftId?: string;
  defaultKind?: AssetKind;
  onUploaded?: (assetId: string) => void;
}

interface QueueItem {
  id: string;
  name: string;
  status: "uploading" | "validating" | "done" | "error";
  error?: string;
}

/**
 * Drag-and-drop upload zone. Performs the two-step Vercel Blob flow:
 *   1) upload() — proxies through /api/assets/upload-url to obtain a token
 *      and then PUTs bytes directly to Blob.
 *   2) POST /api/assets — server-side validate + insert.
 */
export function UploadZone({
  brandId,
  draftId,
  defaultKind = "image",
  onUploaded,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [queue, setQueue] = useState<QueueItem[]>([]);

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      const arr = Array.from(files);
      for (const file of arr) {
        const qId = crypto.randomUUID();
        const kind = inferKind(file, defaultKind);
        setQueue((q) => [
          ...q,
          { id: qId, name: file.name, status: "uploading" },
        ]);
        try {
          const blob = await upload(`assets/${brandId}/${file.name}`, file, {
            access: "public",
            handleUploadUrl: "/api/assets/upload-url",
            contentType: file.type || undefined,
            clientPayload: JSON.stringify({
              brandId,
              kind,
              filename: file.name,
              contentType: file.type || "application/octet-stream",
            }),
          });

          setQueue((q) =>
            q.map((i) => (i.id === qId ? { ...i, status: "validating" } : i)),
          );

          const res = await fetch("/api/assets", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              brandId,
              draftId,
              blobUrl: blob.url,
              kind,
              label: file.name,
              tags: [],
              mimeType: file.type || undefined,
              sizeBytes: file.size,
            }),
          });
          if (!res.ok) {
            const body = (await res.json().catch(() => ({}))) as {
              message?: string;
              error?: string;
            };
            throw new Error(body.message ?? body.error ?? `HTTP ${res.status}`);
          }
          const payload = (await res.json()) as { asset: { id: string } };
          setQueue((q) =>
            q.map((i) => (i.id === qId ? { ...i, status: "done" } : i)),
          );
          onUploaded?.(payload.asset.id);
        } catch (e) {
          setQueue((q) =>
            q.map((i) =>
              i.id === qId
                ? { ...i, status: "error", error: (e as Error).message }
                : i,
            ),
          );
        }
      }
    },
    [brandId, draftId, defaultKind, onUploaded],
  );

  return (
    <div className="space-y-3">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (e.dataTransfer.files?.length) handleFiles(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-10 text-sm transition-colors",
          dragOver
            ? "border-primary bg-accent/40"
            : "border-muted-foreground/30 hover:border-muted-foreground/60",
        )}
      >
        <UploadCloud className="h-8 w-8 text-muted-foreground" />
        <div className="text-center">
          <p className="font-medium">Drop files here or click to browse</p>
          <p className="text-muted-foreground text-xs">
            Video, image, audio, or graphic
          </p>
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) handleFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            inputRef.current?.click();
          }}
        >
          Choose files
        </Button>
      </div>
      {queue.length > 0 && (
        <ul className="space-y-1 text-sm">
          {queue.map((item) => (
            <li
              key={item.id}
              className="flex items-center justify-between rounded border px-3 py-2"
            >
              <span className="truncate">{item.name}</span>
              <span className="flex items-center gap-2 text-xs">
                {item.status === "uploading" && (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Uploading…
                  </>
                )}
                {item.status === "validating" && (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Validating…
                  </>
                )}
                {item.status === "done" && (
                  <span className="text-green-600">Done</span>
                )}
                {item.status === "error" && (
                  <span className="text-destructive" title={item.error}>
                    Failed: {item.error}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function inferKind(file: File, fallback: AssetKind): AssetKind {
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "audio";
  if (file.type.startsWith("image/")) return "image";
  return fallback;
}
