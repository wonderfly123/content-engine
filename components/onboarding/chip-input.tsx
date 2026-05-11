"use client";

import { useState, type KeyboardEvent } from "react";
import { X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface ChipInputProps {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  id?: string;
  className?: string;
  max?: number;
  ariaLabel?: string;
}

/** Lightweight tag/chip input. Enter or comma to commit; backspace deletes. */
export function ChipInput({
  value,
  onChange,
  placeholder,
  id,
  className,
  max = 50,
  ariaLabel,
}: ChipInputProps) {
  const [draft, setDraft] = useState("");

  const commit = (raw: string) => {
    const v = raw.trim();
    if (!v) return;
    if (value.includes(v)) return;
    if (value.length >= max) return;
    onChange([...value, v]);
    setDraft("");
  };

  const remove = (idx: number) => {
    onChange(value.filter((_, i) => i !== idx));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      commit(draft);
    } else if (e.key === "Backspace" && draft.length === 0 && value.length > 0) {
      remove(value.length - 1);
    }
  };

  return (
    <div
      className={cn(
        "flex flex-wrap gap-1.5 rounded-md border bg-background p-2",
        className,
      )}
    >
      {value.map((v, i) => (
        <Badge key={`${v}-${i}`} variant="secondary" className="gap-1 pr-1">
          <span>{v}</span>
          <button
            type="button"
            aria-label={`Remove ${v}`}
            onClick={() => remove(i)}
            className="rounded-sm p-0.5 hover:bg-foreground/10"
          >
            <X className="h-3 w-3" aria-hidden="true" />
          </button>
        </Badge>
      ))}
      <Input
        id={id}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => commit(draft)}
        placeholder={placeholder}
        aria-label={ariaLabel}
        className="h-7 min-w-[8rem] flex-1 border-0 px-1 shadow-none focus-visible:ring-0"
      />
    </div>
  );
}
