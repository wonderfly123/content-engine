"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createBrand } from "./[brandId]/actions";
import { createBrandSchema } from "@/lib/onboarding/types";

export function StartForm() {
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [description, setDescription] = useState("");
  const [pending, startTransition] = useTransition();

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = createBrandSchema.safeParse({ websiteUrl, description });
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      toast.error(first?.message ?? "Please fill in at least one field");
      return;
    }
    startTransition(async () => {
      const res = await createBrand(parsed.data);
      // createBrand redirects on success; only reach here on error.
      if (res && !res.ok) toast.error(res.error);
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
              inputMode="url"
              placeholder="https://example.com"
              value={websiteUrl}
              onChange={(e) => setWebsiteUrl(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              We&apos;ll scrape the homepage to draft your persona.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="desc">Description</Label>
            <Textarea
              id="desc"
              rows={5}
              placeholder="What does this brand do? Who is it for?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Provide a URL, a description, or both.
            </p>
          </div>
          <div className="flex justify-end">
            <Button type="submit" disabled={pending}>
              {pending ? "Creating…" : "Start"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
