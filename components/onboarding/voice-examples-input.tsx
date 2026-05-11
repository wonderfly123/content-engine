"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

export interface VoiceExampleValue {
  caption: string;
  url?: string;
}

interface VoiceExamplesInputProps {
  value: VoiceExampleValue[];
  onChange: (next: VoiceExampleValue[]) => void;
  max?: number;
}

export function VoiceExamplesInput({
  value,
  onChange,
  max = 5,
}: VoiceExamplesInputProps) {
  const update = (i: number, patch: Partial<VoiceExampleValue>) => {
    onChange(value.map((v, idx) => (idx === i ? { ...v, ...patch } : v)));
  };
  const add = () => {
    if (value.length >= max) return;
    onChange([...value, { caption: "", url: "" }]);
  };
  const remove = (i: number) => {
    onChange(value.filter((_, idx) => idx !== i));
  };

  return (
    <div className="space-y-3">
      {value.map((ex, i) => (
        <div key={i} className="rounded-md border p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">
              Example {i + 1}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => remove(i)}
              aria-label={`Remove example ${i + 1}`}
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
          <div className="space-y-2">
            <div className="space-y-1">
              <Label htmlFor={`ex-caption-${i}`}>Caption</Label>
              <Textarea
                id={`ex-caption-${i}`}
                value={ex.caption}
                onChange={(e) => update(i, { caption: e.target.value })}
                rows={3}
                placeholder="Paste a post caption that captures your voice."
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`ex-url-${i}`}>URL (optional)</Label>
              <Input
                id={`ex-url-${i}`}
                value={ex.url ?? ""}
                onChange={(e) => update(i, { url: e.target.value })}
                placeholder="https://instagram.com/p/..."
              />
            </div>
          </div>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={add}
        disabled={value.length >= max}
      >
        <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
        Add example
      </Button>
    </div>
  );
}
