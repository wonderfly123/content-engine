"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { MAX_FOOTAGE_TYPES, type FootageType } from "@/lib/editor/style-schema";
import { ListEditor } from "./fields";

const slug = (name: string) =>
  `custom-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30) || "type"}`;

/** Build and Event come built in; a brand can add its own kinds of shoot. */
export function FootageTypesEditor({ types, onChange }: { types: FootageType[]; onChange: (ts: FootageType[]) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const update = (id: string, patch: Partial<FootageType>) => onChange(types.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  const add = () => {
    const name = newName.trim().slice(0, 60);
    if (!name) return;
    let id = slug(name);
    for (let n = 2; types.some((t) => t.id === id); n++) id = `${slug(name).slice(0, 36)}-${n}`;
    onChange([...types, { id, name, builtIn: false, when: "", ranked: [], pacing: "", notes: "" }]);
    setNewName("");
    setOpen(id);
  };
  return (
    <div className="flex flex-col gap-2">
      {types.map((t) => (
        <div key={t.id} className="rounded-md border">
          <button type="button" className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left" onClick={() => setOpen(open === t.id ? null : t.id)} aria-expanded={open === t.id}>
            <span className="font-medium">{t.name}</span>
            <span className="flex items-center gap-2">
              <Badge variant={t.builtIn ? "secondary" : "outline"}>{t.builtIn ? "Built in" : "Yours"}</Badge>
              <span className="text-sm text-muted-foreground">{open === t.id ? "Hide" : "Edit"}</span>
            </span>
          </button>
          {open === t.id && (
            <div className="flex flex-col gap-3 border-t p-3">
              {!t.builtIn && (
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium">Name</span>
                  <Input className="h-9" value={t.name} maxLength={60} onChange={(e) => update(t.id, { name: e.target.value })} />
                </label>
              )}
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium">Use it for</span>
                <Textarea rows={2} value={t.when} maxLength={600} placeholder="Footage of a tasting day: guests trying flavours, the team pouring" onChange={(e) => update(t.id, { when: e.target.value })} />
              </label>
              <div className="flex flex-col gap-1 text-sm">
                <span className="font-medium">Best shots, strongest first</span>
                <ListEditor label={`Best shots for ${t.name}`} ranked items={t.ranked} placeholder="Add a kind of shot" onChange={(ranked) => update(t.id, { ranked })} />
              </div>
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium">Pacing</span>
                <Textarea rows={4} value={t.pacing} maxLength={2000} placeholder="About 1s shots; speed up only the setup" onChange={(e) => update(t.id, { pacing: e.target.value })} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium">Anything else</span>
                <Textarea rows={4} value={t.notes} maxLength={3000} onChange={(e) => update(t.id, { notes: e.target.value })} />
              </label>
              {!t.builtIn && (
                <Button type="button" variant="ghost" className="self-start text-destructive" onClick={() => onChange(types.filter((x) => x.id !== t.id))}>
                  Remove {t.name}
                </Button>
              )}
            </div>
          )}
        </div>
      ))}
      {types.length < MAX_FOOTAGE_TYPES && (
        <div className="flex gap-2">
          <Input
            aria-label="New footage type"
            className="h-9"
            placeholder="Add your own type, e.g. Tasting day"
            maxLength={60}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
          />
          <Button type="button" variant="outline" onClick={add} disabled={!newName.trim()}>Add</Button>
        </div>
      )}
    </div>
  );
}
