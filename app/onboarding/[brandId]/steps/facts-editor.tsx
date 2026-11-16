"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export interface FactRow {
  fact: string;
  source: string;
}

function sourceLabel(source: string): string {
  if (!source) return "added by you";
  try {
    const u = new URL(source);
    return `${u.hostname.replace(/^www\./, "")}${u.pathname === "/" ? "" : u.pathname}`;
  } catch {
    return source;
  }
}

/** Brand facts as an add/remove list. Facts found by the research show the page they came from. */
export function FactsEditor({ value, onChange }: { value: FactRow[]; onChange: (next: FactRow[]) => void }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const fact = draft.trim();
    if (!fact || value.length >= 40) return;
    onChange([...value, { fact, source: "" }]);
    setDraft("");
  };

  return (
    <div className="space-y-2">
      {value.length === 0 && <p className="text-sm text-muted-foreground">No facts yet. Add the places, products and offers the editor may mention.</p>}
      <ul className="space-y-2">
        {value.map((f, i) => (
          <li key={i} className="flex items-start gap-2">
            <div className="flex-1 space-y-0.5">
              <Input
                aria-label={`Fact ${i + 1}`}
                value={f.fact}
                maxLength={300}
                onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, fact: e.target.value } : x)))}
              />
              <p className="truncate px-1 text-xs text-muted-foreground">From {sourceLabel(f.source)}</p>
            </div>
            <Button type="button" variant="ghost" size="icon" aria-label={`Remove fact ${i + 1}`} onClick={() => onChange(value.filter((_, j) => j !== i))}>
              <X className="h-4 w-4" aria-hidden="true" />
            </Button>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <Input
          aria-label="New fact"
          placeholder="e.g. Open Saturdays at the Little Italy Mercato"
          value={draft}
          maxLength={300}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
        />
        <Button type="button" variant="outline" onClick={add} disabled={!draft.trim() || value.length >= 40} className="shrink-0">
          <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
          Add
        </Button>
      </div>
    </div>
  );
}
