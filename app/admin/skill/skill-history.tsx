"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { historyRequest } from "./api";

/** A file's saved versions (who, when, note), each viewable and restorable as a new version. */
export function SkillHistory({ path, busy, onRestore }: { path: string; busy: boolean; onRestore: (versionId: string) => void }) {
  const { data, isLoading, isError } = useQuery({ queryKey: ["admin-skill-history", path], queryFn: () => historyRequest(path) });
  const [open, setOpen] = useState<string | null>(null);
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">History of {path}</CardTitle>
        <p className="text-sm text-muted-foreground">Every save is kept. Restoring a version saves it again as the newest.</p>
      </CardHeader>
      <CardContent className="flex flex-col divide-y">
        {isLoading && <p className="py-3 text-sm text-muted-foreground">Loading…</p>}
        {isError && <p className="py-3 text-sm text-muted-foreground">Couldn&apos;t load the history.</p>}
        {data && data.length === 0 && <p className="py-3 text-sm text-muted-foreground">Never saved here: the job uses the repo copy.</p>}
        {data?.map((v, i) => (
          <div key={v.id} className="py-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {new Date(v.createdAt).toLocaleString()} · {v.createdBy}
                  {i === 0 && <Badge variant="outline" className="ml-2">Current</Badge>}
                  {v.isDefault && <Badge variant="secondary" className="ml-2">Default</Badge>}
                </p>
                <p className="truncate text-sm text-muted-foreground">{v.note ?? "No note"}</p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" onClick={() => setOpen(open === v.id ? null : v.id)}>{open === v.id ? "Hide" : "View"}</Button>
                {i > 0 && (
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => onRestore(v.id)}>Restore this version</Button>
                )}
              </div>
            </div>
            {open === v.id && (
              <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap rounded-md border bg-muted/40 p-3 font-mono text-xs">{v.content}</pre>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
