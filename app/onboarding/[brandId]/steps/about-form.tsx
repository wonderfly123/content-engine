"use client";

import { useState, useTransition } from "react";
import { Instagram } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { saveAbout } from "../../flow-actions";

interface AboutFormProps {
  brandId: string;
  instagramConnected: boolean;
  initial: { websiteUrl: string; instagramHandle: string; summary: string; captions: string[] };
}

/** Step 3: website, Instagram handle, one sentence, and (without a connected account) captions they like. */
export function AboutForm({ brandId, instagramConnected, initial }: AboutFormProps) {
  const [websiteUrl, setWebsiteUrl] = useState(initial.websiteUrl);
  const [instagramHandle, setInstagramHandle] = useState(initial.instagramHandle);
  const [summary, setSummary] = useState(initial.summary);
  const [captions, setCaptions] = useState<string[]>(() => [...initial.captions, "", "", ""].slice(0, Math.max(3, initial.captions.length)));
  const [pending, start] = useTransition();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      const res = await saveAbout(brandId, { websiteUrl, instagramHandle, summary, captions: instagramConnected ? [] : captions });
      if (res && !res.ok) toast.error(res.error);
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>About your brand</CardTitle>
        <CardDescription>Claude will read your website and look your brand up, then draft how it sounds and what the editor can say.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="website">Website</Label>
            <Input id="website" inputMode="url" placeholder="example.com" value={websiteUrl} onChange={(e) => setWebsiteUrl(e.target.value)} maxLength={500} />
            <p className="text-xs text-muted-foreground">Your home page. Claude reads it and your about, menu or services pages.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ig">
              Instagram handle <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Input id="ig" placeholder="@yourbrand" value={instagramHandle} onChange={(e) => setInstagramHandle(e.target.value)} maxLength={31} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="summary">What do you do?</Label>
            <Textarea id="summary" rows={2} placeholder="One sentence, e.g. We serve fresh young coconuts at events across San Diego." value={summary} onChange={(e) => setSummary(e.target.value)} maxLength={600} required />
          </div>

          {instagramConnected ? (
            <p className="flex items-center gap-2 rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
              <Instagram className="h-4 w-4" aria-hidden="true" />
              Your Instagram account is connected; Claude will learn your voice from your recent captions.
            </p>
          ) : (
            <div className="space-y-2">
              <Label>
                Captions you like <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <p className="text-xs text-muted-foreground">Paste 2 or 3 of your Instagram captions that sound most like you. They teach Claude your voice.</p>
              {captions.map((c, i) => (
                <Textarea
                  key={i}
                  rows={2}
                  aria-label={`Caption ${i + 1}`}
                  value={c}
                  maxLength={2200}
                  onChange={(e) => setCaptions((list) => list.map((x, j) => (j === i ? e.target.value : x)))}
                />
              ))}
              {captions.length < 5 && (
                <Button type="button" variant="ghost" size="sm" onClick={() => setCaptions((list) => [...list, ""])}>
                  Add another
                </Button>
              )}
            </div>
          )}

          <div className="flex justify-end">
            <Button type="submit" disabled={pending || summary.trim().length < 3}>
              {pending ? "Saving…" : "Research my brand"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
