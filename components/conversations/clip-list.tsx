"use client";

import { Film } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatBytes } from "@/lib/media/rules";

export interface Clip {
  id: string;
  filename: string;
  sizeBytes: number;
  status: "uploading" | "ready" | "failed";
  createdAt: string;
}

const STATUS: Record<Clip["status"], { label: string; variant: "default" | "outline" | "destructive" }> = {
  ready: { label: "Ready", variant: "outline" },
  uploading: { label: "Not finished", variant: "outline" },
  failed: { label: "Failed", variant: "destructive" },
};

/** The thread's uploaded clips. A ready clip opens through /api/media (a short-lived private link). */
export function ClipList({ clips }: { clips: Clip[] }) {
  if (clips.length === 0) return null;
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium">
        Clips <span className="text-muted-foreground">({clips.length})</span>
      </h3>
      <ul className="divide-y rounded-md border">
        {clips.map((c) => (
          <li key={c.id} className="flex items-center gap-2 px-3 py-2 text-sm">
            <Film className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            {c.status === "ready" ? (
              <a href={`/api/media/${c.id}`} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate underline-offset-4 hover:underline" title={c.filename}>
                {c.filename}
              </a>
            ) : (
              <span className="min-w-0 flex-1 truncate" title={c.filename}>
                {c.filename}
              </span>
            )}
            <span className="shrink-0 text-xs text-muted-foreground">{formatBytes(c.sizeBytes)}</span>
            <Badge variant={STATUS[c.status].variant}>{STATUS[c.status].label}</Badge>
          </li>
        ))}
      </ul>
    </div>
  );
}
