"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { startOnboarding } from "./flow-actions";

/** Step 1. Asks for the person's name only when the account does not have one yet. */
export function WelcomeForm({ knownName, firstBrand }: { knownName: string | null; firstBrand: boolean }) {
  const [fullName, setFullName] = useState("");
  const [brandName, setBrandName] = useState("");
  const [pending, start] = useTransition();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      const res = await startOnboarding({ fullName: knownName ? undefined : fullName, brandName });
      // On success the action redirects; only an error comes back.
      if (res && !res.ok) toast.error(res.error);
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{firstBrand ? (knownName ? `Welcome, ${knownName.split(/\s+/)[0]}` : "Welcome to Nekter") : "Add a brand"}</CardTitle>
        <CardDescription>
          {firstBrand
            ? "A few minutes of setup teaches your video editor how your brand sounds and what it can say."
            : "We'll research it and set up its voice for the editor."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-4">
          {!knownName && (
            <div className="space-y-1.5">
              <Label htmlFor="full-name">Your name</Label>
              <Input id="full-name" autoComplete="name" value={fullName} onChange={(e) => setFullName(e.target.value)} maxLength={80} required />
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="brand-name">Brand name</Label>
            <Input id="brand-name" placeholder="e.g. Sunset Taqueria" value={brandName} onChange={(e) => setBrandName(e.target.value)} maxLength={120} required />
          </div>
          <div className="flex justify-end">
            <Button type="submit" disabled={pending || !brandName.trim() || (!knownName && !fullName.trim())}>
              {pending ? "Starting…" : "Continue"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
