"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useRouter } from "next/navigation";
import type { Brand } from "../page";

interface Step1Props {
  brand: Pick<Brand, "id" | "websiteUrl" | "description">;
}

/**
 * Step 1 in the wizard. The "real" entry into the wizard is `app/onboarding/page.tsx`
 * (which uses the `StartForm` to create the draft brand). This component exists so
 * the wizard router can re-render Step 1 for editing the initial inputs of an
 * already-created draft. Persisting changes uses PATCH /api/brands/[id].
 */
export function Step1TellMe({ brand }: Step1Props) {
  const router = useRouter();
  const [websiteUrl, setWebsiteUrl] = useState(brand.websiteUrl ?? "");
  const [description, setDescription] = useState(brand.description ?? "");
  const [pending, startTransition] = useTransition();

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!websiteUrl && !description) {
      toast.error("Provide a website URL or description.");
      return;
    }
    startTransition(async () => {
      const res = await fetch(`/api/brands/${brand.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          description,
        }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        toast.error(json.error ?? "Save failed");
        return;
      }
      router.push(`/onboarding/${brand.id}?step=2`);
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tell us about the brand</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="website">Website URL</Label>
            <Input
              id="website"
              type="url"
              value={websiteUrl}
              onChange={(e) => setWebsiteUrl(e.target.value)}
              placeholder="https://example.com"
              disabled
            />
            <p className="text-xs text-muted-foreground">
              Locked after creation. Start a new brand to change it.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="desc">Description</Label>
            <Textarea
              id="desc"
              rows={5}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="flex justify-end">
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Continue"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
