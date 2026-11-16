import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { tryBrand } from "@/lib/auth/workspace";
import { db } from "@/lib/db";
import { brands } from "@/lib/db/schema";
import { connectionsForCaller } from "@/lib/credentials/view";
import { FLOW_STEP_COUNT, flowStateOf, resumeStep } from "@/lib/onboarding/flow";
import { hasInstagramConnection } from "@/lib/onboarding/instagram-captions";
import { reviewInitial } from "@/lib/onboarding/review-initial";
import { StepIndicator } from "@/components/onboarding/step-indicator";
import { ConnectClaude } from "./steps/connect-claude";
import { AboutForm } from "./steps/about-form";
import { ResearchProgress } from "./steps/research-progress";
import { ReviewForm } from "./steps/review-form";
import { Extras } from "./steps/extras";
import { Done } from "./steps/done";

export const dynamic = "force-dynamic";

/** Row shape used by the Settings tabs that reuse the older step components. */
export type Brand = typeof brands.$inferSelect;

interface PageProps {
  params: Promise<{ brandId: string }>;
  searchParams: Promise<{ step?: string; connected?: string }>;
}

/** Steps 2 to 7 of the onboarding flow for one draft brand (step 1 is /onboarding). */
export default async function OnboardingStepPage({ params, searchParams }: PageProps) {
  const { brandId } = await params;
  const { step: stepParam, connected } = await searchParams;

  // Someone else's brand answers 404, the same as one that does not exist.
  const access = await tryBrand(brandId);
  if (!access) notFound();
  const [brand] = await db.select().from(brands).where(eq(brands.id, access.brandId));
  if (!brand) notFound();

  const state = flowStateOf(brand.settingsJson);
  const connections = await connectionsForCaller();
  const anthropic = connections?.items.find((i) => i.provider === "anthropic");
  const keyWorks = Boolean(anthropic?.connected && anthropic.status === "ok");

  // How far they have got; a step further on than that cannot be opened by changing the address.
  let reached = resumeStep(state);
  if (reached === 2 && keyWorks) reached = 3;
  const requested = Number.parseInt(stepParam ?? "", 10);
  let step = Number.isInteger(requested) ? Math.min(Math.max(requested, 2), reached) : reached;

  if (brand.status === "active") {
    if (requested !== 7) redirect(`/dashboard?brand=${brand.slug}`);
    step = 7;
  } else if (step === 7) {
    step = 6;
  }
  if (step === 2 && keyWorks) step = 3;
  if (step === 4 && !state.about?.summary) step = 3;
  if (step === 5 && !state.draft) step = 4;
  if (Number.isInteger(requested) && requested !== step) redirect(`/onboarding/${brand.id}?step=${step}`);

  const instagramConnected = step === 3 || step === 6 ? await hasInstagramConnection(brand.id) : false;

  return (
    <div className="space-y-6">
      <StepIndicator current={Math.min(step, FLOW_STEP_COUNT)} hidden={keyWorks && step !== 2 ? [2] : []} />
      {step === 2 && connections && <ConnectClaude connections={connections} />}
      {step === 3 && (
        <AboutForm
          brandId={brand.id}
          instagramConnected={instagramConnected}
          initial={{
            websiteUrl: brand.websiteUrl ?? "",
            instagramHandle: state.about?.instagramHandle ?? "",
            summary: state.about?.summary ?? brand.description,
            captions: state.about?.captions ?? [],
          }}
        />
      )}
      {step === 4 && <ResearchProgress brandId={brand.id} hasWebsite={Boolean(brand.websiteUrl)} />}
      {step === 5 && (
        <ReviewForm brandId={brand.id} initial={reviewInitial(brand)} note={state.draft?.note} sourceCount={state.draft?.sources.length ?? 0} />
      )}
      {step === 6 && (
        <Extras
          brandId={brand.id}
          instagramConnected={instagramConnected}
          justConnected={connected === "1"}
          appId={process.env.NEXT_PUBLIC_META_APP_ID}
          redirectUri={process.env.NEXT_PUBLIC_META_OAUTH_REDIRECT_URI}
        />
      )}
      {step === 7 && <Done brand={{ id: brand.id, name: brand.name, slug: brand.slug }} />}
    </div>
  );
}
