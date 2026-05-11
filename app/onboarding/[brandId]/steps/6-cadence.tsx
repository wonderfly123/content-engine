import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { cadenceSettings } from "@/lib/db/schema";
import { CadencePicker } from "@/components/onboarding/cadence-picker";
import type {
  CadenceInput,
  CadenceRowInput,
} from "@/lib/onboarding/types";
import type { Brand } from "../page";

interface Step6Props {
  brand: Brand;
}

export async function Step6Cadence({ brand }: Step6Props) {
  const rows = await db
    .select()
    .from(cadenceSettings)
    .where(eq(cadenceSettings.brandId, brand.id));

  const settings = (brand.settingsJson ?? {}) as {
    onboarding?: { preset?: CadenceInput["preset"] };
  };

  const initialRows: CadenceRowInput[] = rows.map((r) => ({
    channel: r.channel,
    format: r.format,
    perWeek: r.perWeek,
    enabled: r.enabled,
  }));

  return (
    <div className="space-y-4">
      <header>
        <h2 className="text-xl font-semibold">Cadence</h2>
        <p className="text-sm text-muted-foreground">
          How many posts per week, per channel and format.
        </p>
      </header>
      <CadencePicker
        brandId={brand.id}
        initialPreset={settings.onboarding?.preset ?? "growth"}
        initialRows={initialRows}
      />
    </div>
  );
}
