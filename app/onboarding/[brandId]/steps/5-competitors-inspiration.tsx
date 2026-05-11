import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { competitors, inspirationAccounts } from "@/lib/db/schema";
import { CompetitorsInspirationForm } from "./5-form";
import type { AccountInput } from "@/lib/onboarding/types";
import type { Brand } from "../page";

interface Step5Props {
  brand: Brand;
}

export async function Step5CompetitorsInspiration({ brand }: Step5Props) {
  const [c, i] = await Promise.all([
    db.select().from(competitors).where(eq(competitors.brandId, brand.id)),
    db
      .select()
      .from(inspirationAccounts)
      .where(eq(inspirationAccounts.brandId, brand.id)),
  ]);

  const toInput = (rows: typeof c | typeof i): AccountInput[] =>
    rows.map((r) => ({
      id: r.id,
      handle: r.handle,
      platform: r.platform,
      url: r.url ?? undefined,
      notes: r.notes ?? "",
      pullWindowDays: r.pullWindowDays,
    }));

  return (
    <div className="space-y-4">
      <header>
        <h2 className="text-xl font-semibold">Competitors and inspiration</h2>
        <p className="text-sm text-muted-foreground">
          Optional. Up to 10 each. We pull recent posts weekly to inform briefs.
        </p>
      </header>
      <CompetitorsInspirationForm
        brandId={brand.id}
        initialCompetitors={toInput(c)}
        initialInspiration={toInput(i)}
      />
    </div>
  );
}
