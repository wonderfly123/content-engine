"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { MAX_ITEM_CHARS, MAX_LIST_ITEMS, type PickValue, type StyleField } from "@/lib/editor/style-schema";

const pill = (on: boolean) =>
  `rounded-full border px-3 py-1 text-sm transition-colors ${on ? "border-primary bg-primary text-primary-foreground" : "border-input hover:bg-muted"}`;

/** A list of short items: type and press Enter; ranked lists can be reordered. */
export function ListEditor({ items, onChange, placeholder, ranked, label }: { items: string[]; onChange: (xs: string[]) => void; placeholder: string; ranked?: boolean; label: string }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const v = draft.trim().slice(0, MAX_ITEM_CHARS);
    if (v && !items.includes(v) && items.length < (ranked ? 10 : MAX_LIST_ITEMS)) onChange([...items, v]);
    setDraft("");
  };
  const move = (i: number, d: -1 | 1) => {
    const next = [...items];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    onChange(next);
  };
  return (
    <div className="flex flex-col gap-2">
      {ranked ? (
        <ol className="flex flex-col gap-1">
          {items.map((x, i) => (
            <li key={x} className="flex items-center gap-2 rounded-md border px-2 py-1 text-sm">
              <span className="w-5 text-muted-foreground">{i + 1}.</span>
              <span className="min-w-0 flex-1">{x}</span>
              <Button type="button" size="icon" variant="ghost" className="size-7" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move ${x} up`}>
                <ArrowUp className="size-4" />
              </Button>
              <Button type="button" size="icon" variant="ghost" className="size-7" disabled={i === items.length - 1} onClick={() => move(i, 1)} aria-label={`Move ${x} down`}>
                <ArrowDown className="size-4" />
              </Button>
              <Button type="button" size="icon" variant="ghost" className="size-7" onClick={() => onChange(items.filter((y) => y !== x))} aria-label={`Remove ${x}`}>
                <X className="size-4" />
              </Button>
            </li>
          ))}
        </ol>
      ) : (
        items.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {items.map((x) => (
              <Badge key={x} variant="secondary" className="gap-1 py-1 pl-2.5 pr-1 text-sm font-normal">
                {x}
                <button type="button" className="rounded-full p-0.5 hover:bg-muted-foreground/20" onClick={() => onChange(items.filter((y) => y !== x))} aria-label={`Remove ${x}`}>
                  <X className="size-3" />
                </button>
              </Badge>
            ))}
          </div>
        )
      )}
      <Input
        aria-label={label}
        className="h-9"
        placeholder={placeholder}
        value={draft}
        maxLength={MAX_ITEM_CHARS}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add();
          }
        }}
        onBlur={add}
      />
    </div>
  );
}

/** One quick pick. */
export function FieldInput({ field, value, onChange, id }: { field: StyleField; value: PickValue; onChange: (v: PickValue) => void; id: string }) {
  switch (field.kind) {
    case "select":
      return (
        <select
          id={id}
          value={value as string}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          {field.options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      );
    case "pills": {
      const on = value as string[];
      return (
        <div id={id} className="flex flex-wrap gap-1.5" role="group">
          {field.options.map((o) => {
            const active = on.includes(o.value);
            return (
              <button
                key={o.value}
                type="button"
                aria-pressed={active}
                className={pill(active)}
                onClick={() => onChange(active ? on.filter((v) => v !== o.value) : field.options.map((x) => x.value).filter((v) => v === o.value || on.includes(v)))}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      );
    }
    case "tags":
    case "ranked":
      return <ListEditor label={field.label} items={value as string[]} onChange={onChange} placeholder={field.placeholder} ranked={field.kind === "ranked"} />;
    case "slider":
      return (
        <div className="flex items-center gap-3">
          <input
            id={id}
            type="range"
            min={field.min}
            max={field.max}
            step={1}
            value={value as number}
            onChange={(e) => onChange(Number(e.target.value))}
            className="w-full max-w-xs accent-primary"
          />
          <span className="w-24 text-sm tabular-nums">{value as number} {field.unit}</span>
        </div>
      );
    case "toggle":
      return (
        <div className="flex items-center gap-2">
          <Switch id={id} checked={Boolean(value)} disabled={field.comingSoon} onCheckedChange={(v) => onChange(v)} />
          {field.comingSoon && <Badge variant="outline">Coming soon</Badge>}
        </div>
      );
    case "text":
      return <Input id={id} className="h-9" value={value as string} maxLength={200} placeholder={field.placeholder} onChange={(e) => onChange(e.target.value)} />;
    case "longtext":
      return <Textarea id={id} rows={2} value={value as string} maxLength={1500} placeholder={field.placeholder} onChange={(e) => onChange(e.target.value)} />;
  }
}
