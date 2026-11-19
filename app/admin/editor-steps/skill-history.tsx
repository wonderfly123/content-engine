"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDistanceToNowStrict } from "date-fns";
import { historyRequest } from "./api";
import { MarkdownView } from "./markdown-view";

/** A file's saved versions (who, when, note), each viewable and restorable as a new version. */
export function SkillHistory({ path, busy, onRestore }: { path: string; busy: boolean; onRestore: (versionId: string) => void }) {
  const { data, isLoading, isError } = useQuery({ queryKey: ["admin-skill-history", path], queryFn: () => historyRequest(path) });
  const [open, setOpen] = useState<string | null>(null);

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (isError) return <p className="text-sm text-muted-foreground">Couldn&apos;t load the history.</p>;
  if (!data || data.length === 0) return <p className="text-sm text-muted-foreground">No changes yet. The editor uses the original version.</p>;

  return (
    <ol className="flex flex-col">
      {data.map((v, i) => {
        const expanded = open === v.id;
        return (
          <li key={v.id} className="relative border-l pb-4 pl-5 last:pb-0">
            <span className={`absolute -left-[5px] top-1.5 size-2.5 rounded-full ${i === 0 ? "bg-primary" : "bg-muted-foreground/40"}`} aria-hidden="true" />
            <div className="flex flex-wrap items-start justify-between gap-2">
              <button type="button" className="min-w-0 text-left" onClick={() => setOpen(expanded ? null : v.id)} aria-expanded={expanded}>
                <p className="flex items-center gap-1.5 text-sm font-medium">
                  {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                  {v.note ?? (v.isDefault ? "Back to the original" : "Edited")}
                  {i === 0 && <Badge variant="outline" className="ml-1">In use</Badge>}
                </p>
                <p className="pl-5 text-xs text-muted-foreground" title={new Date(v.createdAt).toLocaleString()}>
                  {v.createdBy} · {formatDistanceToNowStrict(new Date(v.createdAt))} ago
                </p>
              </button>
              {i > 0 && (
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => onRestore(v.id)}>
                  <RotateCcw className="mr-1.5 size-3.5" aria-hidden="true" />
                  Use this version
                </Button>
              )}
            </div>
            {expanded && (
              <div className="mt-3 max-h-96 overflow-auto rounded-md border bg-muted/20 p-4">
                <MarkdownView source={v.content} />
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
