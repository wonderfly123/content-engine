"use client";

import { useState, useTransition } from "react";
import { Plus, TriangleAlert, X } from "lucide-react";
import { toast } from "sonner";
import { ChipInput } from "@/components/onboarding/chip-input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { ReviewInput } from "@/lib/onboarding/flow-schemas";
import { saveReview } from "../../flow-actions";
import { FactsEditor, type FactRow } from "./facts-editor";

interface ReviewFormProps {
  brandId: string;
  initial: ReviewInput;
  /** Set when the research fell back to what they typed. */
  note?: string;
  sourceCount: number;
}

type Form = Required<{ [K in keyof ReviewInput]: NonNullable<ReviewInput[K]> }>;

/** Step 5: everything the research drafted, editable, with brand facts as an add/remove list. */
export function ReviewForm({ brandId, initial, note, sourceCount }: ReviewFormProps) {
  const [form, setForm] = useState<Form>({
    name: initial.name,
    websiteUrl: initial.websiteUrl ?? "",
    instagramHandle: initial.instagramHandle ?? "",
    whatTheyDo: initial.whatTheyDo,
    whoItsFor: initial.whoItsFor ?? "",
    tone: initial.tone ?? "",
    wordsTheyUse: initial.wordsTheyUse ?? [],
    wordsToAvoid: initial.wordsToAvoid ?? [],
    facts: (initial.facts ?? []).map((f) => ({ fact: f.fact, source: f.source ?? "" })),
    exampleCaptions: initial.exampleCaptions ?? [],
  });
  const [pending, start] = useTransition();
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      const res = await saveReview(brandId, { ...form, exampleCaptions: form.exampleCaptions.map((c) => c.trim()).filter(Boolean) });
      if (res && !res.ok) toast.error(res.error);
    });
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <header>
        <h2 className="text-xl font-semibold">Review your brand</h2>
        <p className="text-sm text-muted-foreground">
          {sourceCount > 0 ? `Drafted from ${sourceCount} pages Claude read. ` : ""}Change anything. The video editor writes from exactly what you save here.
        </p>
      </header>
      {note && (
        <p className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
          {note}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">The brand</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field id="name" label="Name">
              <Input id="name" value={form.name} maxLength={120} onChange={(e) => set("name", e.target.value)} required />
            </Field>
            <Field id="site" label="Website">
              <Input id="site" inputMode="url" value={form.websiteUrl} maxLength={500} onChange={(e) => set("websiteUrl", e.target.value)} />
            </Field>
            <Field id="handle" label="Instagram">
              <Input id="handle" placeholder="@yourbrand" value={form.instagramHandle} maxLength={31} onChange={(e) => set("instagramHandle", e.target.value)} />
            </Field>
          </div>
          <Field id="what" label="What you do">
            <Textarea id="what" rows={2} value={form.whatTheyDo} maxLength={1000} onChange={(e) => set("whatTheyDo", e.target.value)} required />
          </Field>
          <Field id="who" label="Who it's for">
            <Textarea id="who" rows={2} value={form.whoItsFor} maxLength={1000} onChange={(e) => set("whoItsFor", e.target.value)} />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Voice</CardTitle>
          <CardDescription>How your captions and on-screen text should sound.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field id="tone" label="Tone">
            <Textarea id="tone" rows={3} value={form.tone} maxLength={2000} onChange={(e) => set("tone", e.target.value)} />
          </Field>
          <Field id="use" label="Words you use" hint="Press Enter after each one.">
            <ChipInput id="use" value={form.wordsTheyUse} max={30} onChange={(v) => set("wordsTheyUse", v)} ariaLabel="Words you use" />
          </Field>
          <Field id="avoid" label="Words to avoid" hint="Press Enter after each one.">
            <ChipInput id="avoid" value={form.wordsToAvoid} max={30} onChange={(v) => set("wordsToAvoid", v)} ariaLabel="Words to avoid" />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Brand facts</CardTitle>
          <CardDescription>Real places, products, offers and names. The editor may mention these and nothing else, so remove anything wrong.</CardDescription>
        </CardHeader>
        <CardContent>
          <FactsEditor value={form.facts as FactRow[]} onChange={(v) => set("facts", v)} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Example captions</CardTitle>
          <CardDescription>Captions in your voice. The editor uses them as a guide.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {form.exampleCaptions.map((c, i) => (
            <div key={i} className="flex items-start gap-2">
              <Textarea
                rows={2}
                aria-label={`Example caption ${i + 1}`}
                value={c}
                maxLength={2200}
                onChange={(e) => set("exampleCaptions", form.exampleCaptions.map((x, j) => (j === i ? e.target.value : x)))}
              />
              <Button type="button" variant="ghost" size="icon" aria-label={`Remove caption ${i + 1}`} onClick={() => set("exampleCaptions", form.exampleCaptions.filter((_, j) => j !== i))}>
                <X className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          ))}
          {form.exampleCaptions.length < 5 && (
            <Button type="button" variant="outline" size="sm" onClick={() => set("exampleCaptions", [...form.exampleCaptions, ""])}>
              <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
              Add a caption
            </Button>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button type="submit" disabled={pending || !form.name.trim() || !form.whatTheyDo.trim()}>
          {pending ? "Saving…" : "Save and continue"}
        </Button>
      </div>
    </form>
  );
}

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
