import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { tryBrand } from "@/lib/auth/workspace";
import { db } from "@/lib/db";
import { brands } from "@/lib/db/schema";
import { StepIndicator } from "@/components/onboarding/step-indicator";
import { Step1TellMe } from "./steps/1-step1-tell-me";
import { Step2Analyzing } from "./steps/2-analyzing";
import { Step3ReviewProfile } from "./steps/3-review-profile";
import { Step4Icps } from "./steps/4-icps";
import { Step5Cadence } from "./steps/5-cadence";
import { Step6Channels } from "./steps/6-channels";
import { Step7Done } from "./steps/7-done";
import {
  ONBOARDING_STEP_COUNT,
  resolveOnboardingStep,
  type OnboardingState,
} from "@/lib/onboarding/types";

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
  return Math.min(ONBOARDING_STEP_COUNT, Math.max(1, n));
}

export default async function WizardPage({ params, searchParams }: PageProps) {
  const { brandId } = await params;
  const { step: stepParam } = await searchParams;

  // UUID-ish guard — Drizzle will fail loudly if this is malformed.
  if (!/^[0-9a-f-]{8,}$/i.test(brandId)) notFound();

  // Someone else's brand answers 404, the same as one that does not exist.
  // The step components below only ever receive this checked brand.
  const access = await tryBrand(brandId);
  if (!access) notFound();

  const [brand] = await db
    .select()
    .from(brands)
    .where(eq(brands.id, access.brandId));
  if (!brand) notFound();

  if (brand.status === "active") {
    // Already onboarded; bounce to dashboard rather than re-running the wizard.
    redirect(`/dashboard?brand=${brand.slug}`);
  }

  const storedStep = resolveOnboardingStep(
    (brand.settingsJson as { onboarding?: OnboardingState } | null)?.onboarding,
  );
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
      {step === 5 && <Step5Cadence brand={brand} />}
      {step === 6 && <Step6Channels brand={brand} />}
      {step === 7 && <Step7Done brand={brand} />}
    </div>
  );
}
