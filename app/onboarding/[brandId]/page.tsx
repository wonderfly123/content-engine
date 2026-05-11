import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { brands } from "@/lib/db/schema";
import { StepIndicator } from "@/components/onboarding/step-indicator";
import { Step1TellMe } from "./steps/1-step1-tell-me";
import { Step2Analyzing } from "./steps/2-analyzing";
import { Step3ReviewProfile } from "./steps/3-review-profile";
import { Step4Icps } from "./steps/4-icps";
import { Step5CompetitorsInspiration } from "./steps/5-competitors-inspiration";
import { Step6Cadence } from "./steps/6-cadence";
import { Step7Channels } from "./steps/7-channels";
import { Step8Done } from "./steps/8-done";

export const dynamic = "force-dynamic";

/** Row shape exported for step components. */
export type Brand = typeof brands.$inferSelect;

interface PageProps {
  params: Promise<{ brandId: string }>;
  searchParams: Promise<{ step?: string }>;
}

function clampStep(raw: string | undefined, fallback: number): number {
  const n = Number.parseInt(raw ?? "", 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(8, Math.max(1, n));
}

export default async function WizardPage({ params, searchParams }: PageProps) {
  const { brandId } = await params;
  const { step: stepParam } = await searchParams;

  // UUID-ish guard — Drizzle will fail loudly if this is malformed.
  if (!/^[0-9a-f-]{8,}$/i.test(brandId)) notFound();

  const [brand] = await db.select().from(brands).where(eq(brands.id, brandId));
  if (!brand) notFound();

  if (brand.status === "active") {
    // Already onboarded; bounce to dashboard rather than re-running the wizard.
    redirect(`/dashboard?brand=${brand.slug}`);
  }

  const storedStep =
    (
      brand.settingsJson as { onboarding?: { currentStep?: number } }
    )?.onboarding?.currentStep ?? 1;
  const step = clampStep(stepParam, storedStep);

  const alreadyAnalyzed = Boolean(
    (brand.settingsJson as { onboarding?: { draftProfile?: unknown } })
      ?.onboarding?.draftProfile,
  );

  return (
    <div className="space-y-6">
      <StepIndicator current={step} />
      {step === 1 && <Step1TellMe brand={brand} />}
      {step === 2 && (
        <Step2Analyzing brandId={brand.id} alreadyAnalyzed={alreadyAnalyzed} />
      )}
      {step === 3 && <Step3ReviewProfile brand={brand} />}
      {step === 4 && <Step4Icps brand={brand} />}
      {step === 5 && <Step5CompetitorsInspiration brand={brand} />}
      {step === 6 && <Step6Cadence brand={brand} />}
      {step === 7 && <Step7Channels brand={brand} />}
      {step === 8 && <Step8Done brand={brand} />}
    </div>
  );
}
