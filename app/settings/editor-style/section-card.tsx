"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { MAX_NOTES_CHARS, sameValue, type FootageType, type SectionDef, type SectionValue } from "@/lib/editor/style-schema";
import type { StyleSuggestionView } from "@/lib/editor/style-learning";
import type { StyleSectionView } from "@/lib/editor/style-store";
import { styleHistoryRequest, type StyleChange } from "./api";
import { FieldInput } from "./fields";
import { FootageTypesEditor } from "./footage-types";

interface Props {
  brandId: string;
  def: SectionDef;
  view: StyleSectionView;
  draft: SectionValue | undefined;
  onDraft: (v: SectionValue | undefined) => void;
  suggestion: StyleSuggestionView | undefined;
  busy: boolean;
  onChange: (c: StyleChange) => void;
  onDecide: (id: string, decision: "accept" | "dismiss") => void;
}

function History({ brandId, def, busy, onRestore }: { brandId: string; def: SectionDef; busy: boolean; onRestore: (versionId: string) => void }) {
  const { data, isLoading, isError } = useQuery({ queryKey: ["editor-style-history", brandId, def.id], queryFn: () => styleHistoryRequest(brandId, def.id) });
  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (isError || !data) return <p className="text-sm text-muted-foreground">Couldn&apos;t load the history.</p>;
  if (!data.length) return <p className="text-sm text-muted-foreground">Never changed: the editor uses the default.</p>;
  return (
    <ul className="flex flex-col divide-y rounded-md border">
      {data.map((v, i) => (
        <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
          <div className="min-w-0">
            <p className="text-sm">
              {new Date(v.createdAt).toLocaleString()} · {v.createdBy}
              {i === 0 && <Badge variant="outline" className="ml-2">Current</Badge>}
              {v.isDefault && <Badge variant="secondary" className="ml-2">Default</Badge>}
            </p>
            {v.note && <p className="truncate text-sm text-muted-foreground">{v.note}</p>}
          </div>
          {i > 0 && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => onRestore(v.id)}>
              Bring back
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}

/** One section: quick picks, a text box, Save / Reset to default / History. */
export function SectionCard({ brandId, def, view, draft, onDraft, suggestion, busy, onChange, onDecide }: Props) {
  const [showHistory, setShowHistory] = useState(false);
  const value = draft ?? view.value;
  const dirty = draft !== undefined && !sameValue(draft, view.value);
  const set = (patch: Partial<SectionValue>) => onDraft({ ...value, ...patch });
  const setPick = (key: string, v: SectionValue["picks"][string]) => set({ picks: { ...value.picks, [key]: v } });
  const confirmDiscard = () => !dirty || window.confirm(`This drops your unsaved edits to ${def.title}. Continue?`);

  return (
    <Card id={`style-${def.id}`}>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">
            {def.number}. {def.title}
          </CardTitle>
          <Badge variant={view.changed ? "default" : "secondary"}>{view.changed ? "Yours" : "Default"}</Badge>
        </div>
        <p className="text-sm text-muted-foreground">{def.blurb}</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {suggestion && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-dashed bg-muted/40 px-3 py-2">
            <div className="min-w-0 text-sm">
              <p>
                <span className="font-medium">Suggested:</span> {suggestion.change}
              </p>
              {suggestion.reason && <p className="text-muted-foreground">{suggestion.reason}</p>}
            </div>
            <div className="flex gap-2">
              <Button size="sm" disabled={busy || dirty} title={dirty ? "Save or discard your edits first" : undefined} onClick={() => onDecide(suggestion.id, "accept")}>
                Accept
              </Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => onDecide(suggestion.id, "dismiss")}>
                Dismiss
              </Button>
            </div>
          </div>
        )}

        {def.id === "footage" ? (
          <FootageTypesEditor types={value.picks.types as FootageType[]} onChange={(types) => setPick("types", types)} />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {def.fields.map((f) => {
              const id = `style-${def.id}-${f.key}`;
              const wide = f.kind === "pills" || f.kind === "tags" || f.kind === "ranked" || f.kind === "longtext";
              return (
                <div key={f.key} className={`flex flex-col gap-1.5 ${wide ? "sm:col-span-2" : ""}`}>
                  <label htmlFor={id} className="text-sm font-medium">{f.label}</label>
                  <FieldInput id={id} field={f} value={value.picks[f.key]} onChange={(v) => setPick(f.key, v)} />
                  {f.hint && <p className="text-xs text-muted-foreground">{f.hint}</p>}
                </div>
              );
            })}
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <label htmlFor={`style-${def.id}-notes`} className="text-sm font-medium">{def.notesLabel}</label>
          <Textarea
            id={`style-${def.id}-notes`}
            rows={6}
            value={value.notes}
            maxLength={MAX_NOTES_CHARS}
            onChange={(e) => set({ notes: e.target.value })}
            className="font-mono text-xs leading-relaxed"
          />
          <p className="text-xs text-muted-foreground">In your own words. The editor follows this over its defaults.</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={!dirty || busy} onClick={() => onChange({ action: "save", section: def.id, value })}>
            Save
          </Button>
          {dirty && (
            <Button variant="ghost" disabled={busy} onClick={() => onDraft(undefined)}>
              Discard
            </Button>
          )}
          <Button
            variant="outline"
            disabled={busy || (!view.changed && !dirty)}
            onClick={() => {
              if (confirmDiscard() && window.confirm(`Put ${def.title} back to the default? You can bring this version back from History.`)) onChange({ action: "reset", section: def.id });
            }}
          >
            Reset to default
          </Button>
          <Button variant="ghost" onClick={() => setShowHistory((s) => !s)} aria-expanded={showHistory}>
            {showHistory ? "Hide history" : "History"}
          </Button>
          {view.updatedAt && (
            <span className="text-xs text-muted-foreground">
              Last saved {new Date(view.updatedAt).toLocaleDateString()} by {view.updatedBy}
            </span>
          )}
        </div>

        {showHistory && (
          <History
            brandId={brandId}
            def={def}
            busy={busy}
            onRestore={(versionId) => {
              if (confirmDiscard()) onChange({ action: "restore", section: def.id, versionId });
            }}
          />
        )}
      </CardContent>
    </Card>
  );
}
