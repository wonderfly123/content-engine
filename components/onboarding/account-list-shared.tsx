"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { competitorPlatformValues } from "@/lib/db/enums";
import type { AccountInput } from "@/lib/onboarding/types";

interface AccountListProps {
  title: string;
  value: AccountInput[];
  onChange: (next: AccountInput[]) => void;
  max?: number;
}

const blank = (): AccountInput => ({
  handle: "",
  platform: "ig",
  url: undefined,
  notes: "",
  pullWindowDays: 30,
});

export function AccountList({ title, value, onChange, max = 10 }: AccountListProps) {
  const update = (i: number, patch: Partial<AccountInput>) => {
    onChange(value.map((v, idx) => (idx === i ? { ...v, ...patch } : v)));
  };
  const add = () => {
    if (value.length >= max) return;
    onChange([...value, blank()]);
  };
  const remove = (i: number) => onChange(value.filter((_, idx) => idx !== i));

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold">{title}</h3>
      {value.length === 0 && (
        <p className="text-xs text-muted-foreground">
          None yet. This step is optional.
        </p>
      )}
      {value.map((a, i) => (
        <div key={i} className="rounded-md border p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">#{i + 1}</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => remove(i)}
              aria-label="Remove"
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>Handle</Label>
              <Input
                value={a.handle}
                onChange={(e) => update(i, { handle: e.target.value })}
                placeholder="@username"
              />
            </div>
            <div className="space-y-1">
              <Label>Platform</Label>
              <Select
                value={a.platform}
                onValueChange={(p) =>
                  update(i, { platform: p as AccountInput["platform"] })
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {competitorPlatformValues.map((p) => (
                    <SelectItem key={p} value={p}>
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>URL</Label>
              <Input
                value={a.url ?? ""}
                onChange={(e) => update(i, { url: e.target.value })}
                placeholder="https://…"
              />
            </div>
            <div className="space-y-1">
              <Label>Pull window (days)</Label>
              <Input
                type="number"
                min={1}
                max={365}
                value={a.pullWindowDays}
                onChange={(e) =>
                  update(i, {
                    pullWindowDays: Number.parseInt(e.target.value || "30", 10),
                  })
                }
              />
            </div>
          </div>
          <div className="mt-2 space-y-1">
            <Label>Notes</Label>
            <Textarea
              value={a.notes ?? ""}
              onChange={(e) => update(i, { notes: e.target.value })}
              rows={2}
            />
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
        Add
      </Button>
    </div>
  );
}
