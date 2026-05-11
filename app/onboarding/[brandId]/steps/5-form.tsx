"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { CompetitorList } from "@/components/onboarding/competitor-list";
import { InspirationList } from "@/components/onboarding/inspiration-list";
import { saveCompetitorsInspiration } from "../actions";
import {
  competitorsInspirationSchema,
  type AccountInput,
} from "@/lib/onboarding/types";

interface FormProps {
  brandId: string;
  initialCompetitors: AccountInput[];
  initialInspiration: AccountInput[];
}

export function CompetitorsInspirationForm({
  brandId,
  initialCompetitors,
  initialInspiration,
}: FormProps) {
  const [comps, setComps] = useState<AccountInput[]>(initialCompetitors);
  const [insp, setInsp] = useState<AccountInput[]>(initialInspiration);
  const [pending, startTransition] = useTransition();

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = competitorsInspirationSchema.safeParse({
      competitors: comps,
      inspiration: insp,
    });
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      toast.error(`${first?.path.join(".") ?? "form"}: ${first?.message}`);
      return;
    }
    startTransition(async () => {
      const res = await saveCompetitorsInspiration(brandId, parsed.data);
      if (res && !res.ok) toast.error(res.error);
    });
  };

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <CompetitorList value={comps} onChange={setComps} />
        <InspirationList value={insp} onChange={setInsp} />
      </div>
      <div className="flex justify-between">
        <Button asChild variant="ghost" size="sm">
          <Link href={`/onboarding/${brandId}?step=6`}>Skip</Link>
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save and continue"}
        </Button>
      </div>
    </form>
  );
}
