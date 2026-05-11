"use client";

import { useState, useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { saveICPs } from "@/app/onboarding/[brandId]/actions";
import { icpsSchema, type IcpInput } from "@/lib/onboarding/types";
import { ChipInput } from "./chip-input";

interface IcpEditorProps {
  brandId: string;
  initial: IcpInput[];
}

const blank = (): IcpInput => ({
  name: "",
  description: "",
  painPoints: [],
  whereTheyHangOut: "",
  contentTheyEngageWith: "",
  isDefault: false,
});

export function IcpEditor({ brandId, initial }: IcpEditorProps) {
  const [items, setItems] = useState<IcpInput[]>(
    initial.length > 0 ? initial : [blank()],
  );
  const [pending, startTransition] = useTransition();

  const update = (i: number, patch: Partial<IcpInput>) => {
    setItems(items.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  };
  const setDefault = (i: number) => {
    setItems(items.map((it, idx) => ({ ...it, isDefault: idx === i })));
  };
  const add = () => {
    if (items.length >= 3) return;
    setItems([...items, blank()]);
  };
  const remove = (i: number) => {
    setItems(items.filter((_, idx) => idx !== i));
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = icpsSchema.safeParse({ icps: items });
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      toast.error(`${first?.path.join(".") ?? "form"}: ${first?.message}`);
      return;
    }
    startTransition(async () => {
      const res = await saveICPs(brandId, parsed.data);
      if (res && !res.ok) toast.error(res.error);
    });
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {items.map((it, i) => (
        <Card key={it.id ?? i}>
          <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
            <CardTitle className="text-base">ICP {i + 1}</CardTitle>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <Switch
                  id={`default-${i}`}
                  checked={it.isDefault}
                  onCheckedChange={(checked) =>
                    checked ? setDefault(i) : update(i, { isDefault: false })
                  }
                  aria-label="Set as default ICP"
                />
                <Label htmlFor={`default-${i}`} className="text-xs">
                  Default
                </Label>
              </div>
              {items.length > 1 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => remove(i)}
                  aria-label={`Remove ICP ${i + 1}`}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor={`name-${i}`}>Name</Label>
              <Input
                id={`name-${i}`}
                value={it.name}
                onChange={(e) => update(i, { name: e.target.value })}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`desc-${i}`}>Description</Label>
              <Textarea
                id={`desc-${i}`}
                value={it.description}
                onChange={(e) => update(i, { description: e.target.value })}
                rows={2}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`pain-${i}`}>Pain points</Label>
              <ChipInput
                id={`pain-${i}`}
                value={it.painPoints}
                onChange={(painPoints) => update(i, { painPoints })}
                placeholder="Add pain point, press Enter"
                ariaLabel="Pain points"
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor={`where-${i}`}>Where they hang out</Label>
                <Textarea
                  id={`where-${i}`}
                  value={it.whereTheyHangOut}
                  onChange={(e) =>
                    update(i, { whereTheyHangOut: e.target.value })
                  }
                  rows={2}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`engage-${i}`}>Content they engage with</Label>
                <Textarea
                  id={`engage-${i}`}
                  value={it.contentTheyEngageWith}
                  onChange={(e) =>
                    update(i, { contentTheyEngageWith: e.target.value })
                  }
                  rows={2}
                />
              </div>
            </div>
          </CardContent>
        </Card>
      ))}

      <div className="flex items-center justify-between">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={add}
          disabled={items.length >= 3}
        >
          <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
          Add ICP
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save and continue"}
        </Button>
      </div>
    </form>
  );
}
