"use client";

import { useRef, useState } from "react";
import { Plus, RotateCcw, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatBytes } from "@/lib/media/rules";
import { cn } from "@/lib/utils";
import { useClipUploads, type UploadItem } from "./use-clip-uploads";

const pct = (part: number, whole: number) => (whole > 0 ? Math.min(100, Math.round((part / whole) * 100)) : 0);

function Bar({ value, className }: { value: number; className?: string }) {
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-muted", className)} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={value}>
      <div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${value}%` }} />
    </div>
  );
}

/** "Add clips" and drag-and-drop for an open thread, with progress for each file and the batch. */
export function ClipUploader({ conversationId, onChange }: { conversationId: string; onChange: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const up = useClipUploads(conversationId, onChange);

  return (
    <div
      className={cn("space-y-3 rounded-md border border-dashed bg-muted/30 p-3 text-sm transition-colors", dragging && "border-primary bg-primary/5")}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        up.addFiles(Array.from(e.dataTransfer.files));
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-muted-foreground">
          <Upload className="h-4 w-4 shrink-0" aria-hidden="true" />
          Drop video clips here
        </span>
        <Button size="sm" variant="outline" onClick={() => input.current?.click()}>
          <Plus aria-hidden="true" />
          Add clips
        </Button>
        <input
          ref={input}
          type="file"
          multiple
          accept="video/*,.mov,.mp4,.m4v"
          className="hidden"
          onChange={(e) => {
            up.addFiles(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
      </div>

      <UploadProgress up={up} />
    </div>
  );
}

/** Progress for the files being uploaded (and a note about unfinished ones), shown above the composer. */
export function UploadProgress({ up }: { up: ReturnType<typeof useClipUploads> }) {
  const anyFinished = up.items.some((i) => i.status === "done" || i.status === "failed" || i.status === "cancelled");
  if (up.items.length === 0 && up.leftover === 0) return null;
  return (
    <div className="space-y-3 text-sm">
      {up.leftover > 0 && up.items.length === 0 && (
        <p className="text-xs text-muted-foreground">
          {up.leftover === 1 ? "One upload" : `${up.leftover} uploads`} didn&apos;t finish. Add the same {up.leftover === 1 ? "file" : "files"} again to pick up where {up.leftover === 1 ? "it" : "they"} stopped.
        </p>
      )}

      {up.items.length > 0 && (
        <div className="space-y-3">
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>
                {formatBytes(up.sentBytes)} of {formatBytes(up.totalBytes)}
              </span>
              <span>{pct(up.sentBytes, up.totalBytes)}%</span>
            </div>
            <Bar value={pct(up.sentBytes, up.totalBytes)} />
            {up.uploading && <p className="text-xs font-medium text-foreground">Keep this page open while clips upload.</p>}
          </div>
          {/* Only files that still need something are listed (in a short scrolling box); finished ones are counted. */}
          {(() => {
            const open = up.items.filter((i) => i.status !== "done" && i.status !== "cancelled");
            const done = up.items.filter((i) => i.status === "done").length;
            const cancelled = up.items.filter((i) => i.status === "cancelled").length;
            return (
              <>
                {(done > 0 || cancelled > 0) && (
                  <p className="text-xs text-muted-foreground">
                    {done > 0 && `${done} uploaded`}
                    {done > 0 && cancelled > 0 && " · "}
                    {cancelled > 0 && `${cancelled} cancelled`}
                  </p>
                )}
                {open.length > 0 && (
                  <ul className="max-h-48 space-y-2 overflow-y-auto pr-1">
                    {open.map((item) => (
                      <UploadRow key={item.id} item={item} onCancel={up.cancel} onResume={up.resume} onStartOver={up.startOver} onRetry={up.retry} />
                    ))}
                  </ul>
                )}
              </>
            );
          })()}
          {anyFinished && !up.uploading && (
            <div className="flex justify-end">
              <Button size="xs" variant="ghost" onClick={up.clearFinished}>
                Clear finished
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const STATUS_TEXT: Record<UploadItem["status"], string> = {
  resumable: "Partly uploaded before",
  queued: "Waiting",
  uploading: "Uploading",
  done: "Uploaded",
  failed: "Failed",
  cancelled: "Cancelled",
};

function UploadRow({
  item,
  onCancel,
  onResume,
  onStartOver,
  onRetry,
}: {
  item: UploadItem;
  onCancel: (id: string) => void;
  onResume: (id: string) => void;
  onStartOver: (id: string) => void;
  onRetry: (id: string) => void;
}) {
  const value = item.status === "done" ? 100 : pct(item.uploaded, item.file.size);
  return (
    <li className="space-y-1">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-medium" title={item.file.name}>
          {item.file.name}
        </span>
        <span className="shrink-0 text-xs text-muted-foreground">{formatBytes(item.file.size)}</span>
        {item.status === "resumable" && (
          <>
            <Button size="xs" onClick={() => onResume(item.id)}>
              Resume
            </Button>
            <Button size="xs" variant="outline" onClick={() => onStartOver(item.id)}>
              Start over
            </Button>
          </>
        )}
        {item.status === "failed" && (
          <Button size="xs" variant="outline" onClick={() => onRetry(item.id)}>
            <RotateCcw aria-hidden="true" />
            Retry
          </Button>
        )}
        {(item.status === "queued" || item.status === "uploading" || item.status === "resumable" || item.status === "failed") && (
          <Button size="icon-xs" variant="ghost" onClick={() => onCancel(item.id)} aria-label={`Cancel ${item.file.name}`}>
            <X aria-hidden="true" />
          </Button>
        )}
      </div>
      {item.status !== "cancelled" && <Bar value={value} className={cn(item.status === "failed" && "[&>div]:bg-destructive")} />}
      <p className={cn("text-xs", item.status === "failed" ? "text-destructive" : "text-muted-foreground")}>
        {STATUS_TEXT[item.status]}
        {item.status === "uploading" || item.status === "resumable" ? ` · ${value}%` : ""}
        {item.error ? ` · ${item.error}` : ""}
      </p>
    </li>
  );
}
