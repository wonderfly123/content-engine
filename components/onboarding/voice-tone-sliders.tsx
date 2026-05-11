"use client";

import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";

export type ToneKey =
  | "formality"
  | "playfulness"
  | "authority"
  | "boldness"
  | "wit"
  | "verbosity";

const SLIDERS: Array<{ key: ToneKey; left: string; right: string }> = [
  { key: "formality", left: "Formal", right: "Casual" },
  { key: "playfulness", left: "Serious", right: "Playful" },
  { key: "authority", left: "Authoritative", right: "Friendly" },
  { key: "boldness", left: "Reserved", right: "Bold" },
  { key: "wit", left: "Plain", right: "Witty" },
  { key: "verbosity", left: "Concise", right: "Verbose" },
];

interface VoiceToneSlidersProps {
  value: Record<ToneKey, number>;
  onChange: (next: Record<ToneKey, number>) => void;
}

export function VoiceToneSliders({ value, onChange }: VoiceToneSlidersProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {SLIDERS.map((s) => {
        const v = value[s.key] ?? 50;
        return (
          <div key={s.key} className="space-y-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <Label className="text-xs font-medium">{s.left}</Label>
              <span aria-hidden="true">{v}</span>
              <Label className="text-xs font-medium">{s.right}</Label>
            </div>
            <Slider
              min={0}
              max={100}
              step={1}
              value={[v]}
              onValueChange={(arr) =>
                onChange({ ...value, [s.key]: arr[0] ?? 50 })
              }
              aria-label={`${s.left} to ${s.right}`}
            />
          </div>
        );
      })}
    </div>
  );
}
