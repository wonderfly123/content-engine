import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { icps } from "@/lib/db/schema";
import { IcpEditor } from "@/components/onboarding/icp-editor";
import type { IcpInput } from "@/lib/onboarding/types";
import type { Brand } from "../page";
import type { DraftedProfile } from "@/lib/onboarding/analyze";

interface Step4Props {
  brand: Brand;
}

export async function Step4Icps({ brand }: Step4Props) {
  const rows = await db
    .select()
    .from(icps)
    .where(eq(icps.brandId, brand.id));

  let initial: IcpInput[];
  if (rows.length > 0) {
    initial = rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      painPoints: r.painPoints ?? [],
      whereTheyHangOut: r.whereTheyHangOut,
      contentTheyEngageWith: r.contentTheyEngageWith,
      isDefault: r.isDefault,
    }));
  } else {
    const draft = (
      brand.settingsJson as { onboarding?: { draftProfile?: DraftedProfile } }
    )?.onboarding?.draftProfile?.icps;
    initial = draft ?? [];
  }

  return (
    <div className="space-y-4">
      <header>
        <h2 className="text-xl font-semibold">Ideal customer profiles</h2>
        <p className="text-sm text-muted-foreground">
          Up to 3. The default ICP drives weekly brief generation.
        </p>
      </header>
      <IcpEditor brandId={brand.id} initial={initial} />
    </div>
  );
}
