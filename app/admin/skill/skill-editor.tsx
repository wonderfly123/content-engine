"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { MAX_SKILL_FILE_BYTES, MAX_SKILL_NOTE_CHARS, utf8Bytes, type SkillFileView } from "@/lib/editor/skill-files";
import { skillRequest, type SkillChange } from "./api";
import { SkillHistory } from "./skill-history";

function without(drafts: Record<string, string>, path: string): Record<string, string> {
  const next = { ...drafts };
  delete next[path];
  return next;
}

const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`;

/** Warns before the tab closes or an in-app link is followed while `dirty`. */
function useLeaveWarning(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const message = "You have unsaved changes to the editor skill. Leave without saving?";
    const onUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    // Capture phase on document runs before Next's <Link> handler, so cancelling here stops the navigation.
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || e.metaKey || e.ctrlKey || e.shiftKey) return;
      if (!window.confirm(message)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", onUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty]);
}

export function SkillEditor() {
  const qc = useQueryClient();
  const { data: files, isLoading, isError } = useQuery({ queryKey: ["admin-skill"], queryFn: () => skillRequest() });
  const [selected, setSelected] = useState<string>("SKILL.md");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");

  const file = files?.find((f) => f.path === selected) ?? files?.[0];
  const isDirty = (f: SkillFileView) => drafts[f.path] !== undefined && drafts[f.path] !== f.content;
  const anyDirty = (files ?? []).some(isDirty);
  useLeaveWarning(anyDirty);

  const change = useMutation({
    mutationFn: (c: SkillChange) => skillRequest(c),
    onSuccess: (rows, c) => {
      qc.setQueryData(["admin-skill"], rows);
      qc.invalidateQueries({ queryKey: ["admin-skill-history", c.path] });
      setDrafts((d) => without(d, c.path));
      setNote("");
      toast.success(c.action === "save" ? "Saved. The next editor job uses it." : c.action === "reset" ? "Reset to the repo default" : "Version restored");
    },
    onError: (e) => toast.error((e as Error).message),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (isError || !files || !file) return <p className="text-sm text-muted-foreground">Couldn&apos;t load the editor skill.</p>;

  const text = drafts[file.path] ?? file.content;
  const dirty = isDirty(file);
  const bytes = utf8Bytes(text);
  const tooBig = bytes > MAX_SKILL_FILE_BYTES;
  const confirmDiscard = (what: string) => !dirty || window.confirm(`${what} will discard your unsaved edits to ${file.path}. Continue?`);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <p className="text-sm text-muted-foreground">
          The instructions the cloud video editor follows. Saved changes reach the next editor job; files you never change use the copy in the repo. Scripts stay in the repo.
        </p>
      </header>

      <div className="grid gap-6 md:grid-cols-[14rem_1fr]">
        <Card className="h-fit">
          <CardHeader className="pb-2"><CardTitle className="text-base">Files</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-1 p-2">
            {files.map((f) => (
              <button
                key={f.path}
                type="button"
                onClick={() => setSelected(f.path)}
                aria-current={f.path === file.path ? "true" : undefined}
                className={`flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm ${f.path === file.path ? "bg-muted font-medium" : "hover:bg-muted/60"}`}
              >
                <span className="truncate font-mono text-xs">{f.path}{isDirty(f) ? " •" : ""}</span>
                <Badge variant={f.changed ? "default" : "secondary"}>{f.changed ? "Changed" : "Default"}</Badge>
              </button>
            ))}
            {anyDirty && <p className="px-2 pt-2 text-xs text-muted-foreground">• unsaved edits</p>}
          </CardContent>
        </Card>

        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <CardHeader className="pb-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="font-mono text-base">{file.path}</CardTitle>
                <Badge variant={file.changed ? "default" : "secondary"}>{file.changed ? "Changed" : "Default"}</Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                {file.updatedAt ? `Last saved ${new Date(file.updatedAt).toLocaleString()} by ${file.updatedBy}` : "Never saved here: the repo copy."}
              </p>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <label htmlFor="skill-text" className="sr-only">Contents of {file.path}</label>
              <textarea
                id="skill-text"
                spellCheck={false}
                value={text}
                onChange={(e) => setDrafts((d) => ({ ...d, [file.path]: e.target.value }))}
                className="h-[60vh] w-full resize-y rounded-md border border-input bg-transparent p-3 font-mono text-xs leading-relaxed outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              />
              <p className={`text-xs ${tooBig ? "text-destructive" : "text-muted-foreground"}`}>
                {kb(bytes)} of {kb(MAX_SKILL_FILE_BYTES)}{dirty ? " · unsaved" : ""}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <label htmlFor="skill-note" className="sr-only">Note</label>
                <Input
                  id="skill-note"
                  className="h-9 min-w-0 flex-1"
                  placeholder="Note (optional): what changed and why"
                  maxLength={MAX_SKILL_NOTE_CHARS}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
                <Button disabled={!dirty || tooBig || change.isPending} onClick={() => change.mutate({ action: "save", path: file.path, content: text, note: note.trim() || undefined })}>
                  Save
                </Button>
                {dirty && (
                  <Button variant="ghost" disabled={change.isPending} onClick={() => setDrafts((d) => without(d, file.path))}>
                    Discard
                  </Button>
                )}
                <Button
                  variant="outline"
                  disabled={change.isPending || (!file.changed && !dirty)}
                  onClick={() => {
                    if (confirmDiscard("Resetting") && window.confirm(`Reset ${file.path} to the repo default? It is saved as a new version, so you can restore the current one later.`)) {
                      change.mutate({ action: "reset", path: file.path });
                    }
                  }}
                >
                  Reset to default
                </Button>
              </div>
            </CardContent>
          </Card>

          <SkillHistory
            path={file.path}
            busy={change.isPending}
            onRestore={(versionId) => {
              if (confirmDiscard("Restoring")) change.mutate({ action: "restore", path: file.path, versionId });
            }}
          />
        </div>
      </div>
    </div>
  );
}
