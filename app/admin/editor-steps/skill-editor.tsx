"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNowStrict } from "date-fns";
import { BookOpen, ChevronDown, ChevronRight, History, Pencil, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { MAX_SKILL_FILE_BYTES, MAX_SKILL_NOTE_CHARS, utf8Bytes, type SkillFileView, type SkillPath } from "@/lib/editor/skill-files";
import { skillRequest, type SkillChange } from "./api";
import { MarkdownView, splitSections } from "./markdown-view";
import { STEP_GROUPS, STEP_META } from "./skill-meta";
import { SkillHistory } from "./skill-history";

type Mode = "read" | "edit" | "history";

function without(drafts: Record<string, string>, path: string): Record<string, string> {
  const next = { ...drafts };
  delete next[path];
  return next;
}

/** Warns before the tab closes or an in-app link is followed while `dirty`. */
function useLeaveWarning(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const message = "You have unsaved changes to the editor steps. Leave without saving?";
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

/** The file read as collapsible sections, one per "## " heading. */
function ReadView({ content }: { content: string }) {
  const { intro, sections } = splitSections(content);
  const [open, setOpen] = useState<Set<number>>(() => new Set([0]));
  const allOpen = sections.length > 0 && open.size === sections.length;
  const toggle = (i: number) =>
    setOpen((s) => {
      const next = new Set(s);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  return (
    <div className="flex flex-col gap-4">
      {intro && <MarkdownView source={intro} />}
      {sections.length > 1 && (
        <button type="button" className="self-end text-xs text-muted-foreground hover:text-foreground" onClick={() => setOpen(allOpen ? new Set() : new Set(sections.map((_, i) => i)))}>
          {allOpen ? "Collapse all" : "Expand all"}
        </button>
      )}
      <div className="flex flex-col divide-y rounded-lg border">
        {sections.map((s, i) => {
          const isOpen = open.has(i);
          return (
            <section key={`${i}-${s.title}`}>
              <button type="button" onClick={() => toggle(i)} aria-expanded={isOpen} className="flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-muted/40">
                {isOpen ? <ChevronDown className="size-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="size-4 shrink-0 text-muted-foreground" />}
                <span className="text-sm font-medium">{s.title}</span>
              </button>
              {isOpen && (
                <div className="px-4 pb-4 pl-10">
                  <MarkdownView source={s.body} />
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

const MODES: Array<{ value: Mode; label: string; Icon: typeof BookOpen }> = [
  { value: "read", label: "Read", Icon: BookOpen },
  { value: "edit", label: "Edit", Icon: Pencil },
  { value: "history", label: "History", Icon: History },
];

export function SkillEditor() {
  const qc = useQueryClient();
  const { data: files, isLoading, isError } = useQuery({ queryKey: ["admin-skill"], queryFn: () => skillRequest() });
  const [selected, setSelected] = useState<SkillPath>("SKILL.md");
  const [mode, setMode] = useState<Mode>("read");
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
      setMode("read");
      toast.success(c.action === "save" ? "Saved. The next edit uses it." : c.action === "reset" ? "Back to the original" : "Version restored");
    },
    onError: (e) => toast.error((e as Error).message),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (isError || !files || !file) return <p className="text-sm text-muted-foreground">Couldn&apos;t load the editor steps.</p>;

  const meta = STEP_META[file.path];
  const text = drafts[file.path] ?? file.content;
  const dirty = isDirty(file);
  const bytes = utf8Bytes(text);
  const tooBig = bytes > MAX_SKILL_FILE_BYTES;
  const nearLimit = bytes > MAX_SKILL_FILE_BYTES * 0.8;
  const confirmDiscard = (what: string) => !dirty || window.confirm(`${what} will throw away your unsaved changes to ${meta.title}. Continue?`);
  const byPath = new Map(files.map((f) => [f.path, f]));

  return (
    <div className="grid gap-6 md:grid-cols-[16rem_1fr]">
      <nav aria-label="Editor steps" className="flex flex-col gap-5 md:sticky md:top-0 md:self-start">
        {STEP_GROUPS.map((g) => (
          <div key={g.label} className="flex flex-col gap-0.5">
            <p className="px-3 pb-1 text-xs font-medium text-muted-foreground">{g.label}</p>
            {g.paths.map((p) => {
              const f = byPath.get(p);
              if (!f) return null;
              const active = p === file.path;
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => setSelected(p)}
                  aria-current={active ? "true" : undefined}
                  className={cn("rounded-lg px-3 py-2 text-left transition-colors", active ? "bg-muted" : "hover:bg-muted/60")}
                >
                  <span className="flex items-center gap-2 text-sm font-medium">
                    {STEP_META[p].title}
                    {isDirty(f) && <span className="size-1.5 rounded-full bg-amber-500" aria-label="Unsaved changes" />}
                    {f.changed && <span className="ml-auto rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">Edited</span>}
                  </span>
                  <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">{STEP_META[p].blurb}</span>
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-lg font-semibold tracking-tight">{meta.title}</h3>
            <p className="text-sm text-muted-foreground">{meta.blurb}</p>
            {file.updatedAt && (
              <p className="mt-1 text-xs text-muted-foreground">
                Last changed by {file.updatedBy} {formatDistanceToNowStrict(new Date(file.updatedAt))} ago
              </p>
            )}
          </div>
          <div role="tablist" aria-label="View" className="flex rounded-lg border p-0.5">
            {MODES.map(({ value, label, Icon }) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={mode === value}
                onClick={() => setMode(value)}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors",
                  mode === value ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="size-3.5" aria-hidden="true" />
                {label}
              </button>
            ))}
          </div>
        </div>

        {mode === "read" && <ReadView key={file.path + file.content.length} content={dirty ? text : file.content} />}

        {mode === "edit" && (
          <div className="flex flex-col gap-3">
            <label htmlFor="skill-text" className="sr-only">Contents of {meta.title}</label>
            <textarea
              id="skill-text"
              spellCheck={false}
              value={text}
              onChange={(e) => setDrafts((d) => ({ ...d, [file.path]: e.target.value }))}
              className="h-[60vh] w-full resize-y rounded-lg border border-input bg-transparent p-4 font-mono text-[13px] leading-relaxed outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
            {nearLimit && (
              <p className={cn("text-xs", tooBig ? "text-destructive" : "text-muted-foreground")}>
                {tooBig ? "Too long to save. " : "Getting close to the size limit. "}
                {(bytes / 1024).toFixed(0)} of {MAX_SKILL_FILE_BYTES / 1024} KB
              </p>
            )}
            <div className="sticky bottom-0 flex flex-wrap items-center gap-2 rounded-lg border bg-background/95 p-2 backdrop-blur">
              <label htmlFor="skill-note" className="sr-only">What changed</label>
              <Input
                id="skill-note"
                className="h-9 min-w-0 flex-1"
                placeholder="What changed? (optional)"
                maxLength={MAX_SKILL_NOTE_CHARS}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              <Button variant="ghost" disabled={change.isPending} onClick={() => { setDrafts((d) => without(d, file.path)); setMode("read"); }}>
                Cancel
              </Button>
              <Button disabled={!dirty || tooBig || change.isPending} onClick={() => change.mutate({ action: "save", path: file.path, content: text, note: note.trim() || undefined })}>
                {change.isPending ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        )}

        {mode === "history" && (
          <div className="flex flex-col gap-4">
            {file.changed && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
                <p className="text-sm text-muted-foreground">Changed from the original. Going back keeps this version in the history.</p>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={change.isPending}
                  onClick={() => {
                    if (confirmDiscard("Going back") && window.confirm(`Go back to the original ${meta.title}?`)) change.mutate({ action: "reset", path: file.path });
                  }}
                >
                  <RotateCcw className="mr-1.5 size-3.5" aria-hidden="true" />
                  Back to original
                </Button>
              </div>
            )}
            <SkillHistory
              path={file.path}
              busy={change.isPending}
              onRestore={(versionId) => {
                if (confirmDiscard("Restoring")) change.mutate({ action: "restore", path: file.path, versionId });
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
