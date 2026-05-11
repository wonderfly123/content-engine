"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import { saveCadence } from "@/app/onboarding/[brandId]/actions";
import {
  CADENCE_PRESETS,
  cadenceSchema,
  type CadenceInput,
  type CadenceRowInput,
} from "@/lib/onboarding/types";

const PRESETS: Array<{
  key: "sustainable" | "growth" | "aggressive" | "custom";
  label: string;
  blurb: string;
  star?: boolean;
}> = [
  {
    key: "sustainable",
    label: "Sustainable",
    blurb: "2 Reels + 1 Carousel / week",
  },
  {
    key: "growth",
    label: "Growth",
    blurb: "5 Reels + 2 Carousels / week",
    star: true,
  },
  {
    key: "aggressive",
    label: "Aggressive",
    blurb: "7 Reels + 3 Carousels + 2 Images / week",
  },
  { key: "custom", label: "Custom", blurb: "Roll your own" },
];

const CUSTOM_TEMPLATE: CadenceRowInput[] = [
  { channel: "instagram", format: "reel", perWeek: 5, enabled: true },
  { channel: "instagram", format: "carousel", perWeek: 2, enabled: true },
  { channel: "instagram", format: "image", perWeek: 0, enabled: true },
];

interface CadencePickerProps {
  brandId: string;
  initialPreset?: CadenceInput["preset"];
  initialRows?: CadenceRowInput[];
}

export function CadencePicker({
  brandId,
  initialPreset = "growth",
  initialRows,
}: CadencePickerProps) {
  const [preset, setPreset] = useState<CadenceInput["preset"]>(initialPreset);
  const [custom, setCustom] = useState<CadenceRowInput[]>(
    initialRows && initialRows.length > 0 ? initialRows : CUSTOM_TEMPLATE,
  );
  const [pending, startTransition] = useTransition();

  const rows = useMemo<CadenceRowInput[]>(() => {
    if (preset === "custom") return custom;
    return CADENCE_PRESETS[preset];
  }, [preset, custom]);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const payload: CadenceInput = { preset, rows: preset === "custom" ? custom : [] };
    const parsed = cadenceSchema.safeParse(payload);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Validation failed");
      return;
    }
    startTransition(async () => {
      const res = await saveCadence(brandId, parsed.data);
      if (res && !res.ok) toast.error(res.error);
    });
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {PRESETS.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => setPreset(p.key)}
            className={cn(
              "rounded-md border p-3 text-left transition-colors",
              preset === p.key
                ? "border-primary bg-primary/5"
                : "hover:border-foreground/40",
            )}
            aria-pressed={preset === p.key}
          >
            <div className="flex items-center gap-1.5 text-sm font-semibold">
              {p.label}
              {p.star && (
                <Sparkles className="h-3.5 w-3.5 text-amber-500" aria-hidden="true" />
              )}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{p.blurb}</p>
          </button>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Preview</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {preset !== "custom" ? (
            <ul className="text-sm">
              {rows.map((r) => (
                <li key={`${r.channel}-${r.format}`} className="flex justify-between py-1">
                  <span className="capitalize">
                    {r.channel} {r.format}
                  </span>
                  <span className="font-medium">{r.perWeek}/week</span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="space-y-4">
              {custom.map((row, i) => (
                <div key={`${row.channel}-${row.format}`} className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <Label className="capitalize">
                      {row.channel} {row.format}
                    </Label>
                    <span className="font-medium">{row.perWeek}/week</span>
                  </div>
                  <Slider
                    min={0}
                    max={14}
                    step={1}
                    value={[row.perWeek]}
                    onValueChange={(arr) =>
                      setCustom(
                        custom.map((r, idx) =>
                          idx === i ? { ...r, perWeek: arr[0] ?? 0 } : r,
                        ),
                      )
                    }
                    aria-label={`${row.channel} ${row.format} per week`}
                  />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save and continue"}
        </Button>
      </div>
    </form>
  );
}
