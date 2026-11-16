import Link from "next/link";
import { redirect } from "next/navigation";
import { and, desc, eq, inArray } from "drizzle-orm";
import { ArrowRight } from "lucide-react";
import { listBrandIds, tryWorkspace } from "@/lib/auth/workspace";
import { db } from "@/lib/db";
import { brands } from "@/lib/db/schema";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FLOW_STEP_COUNT, FLOW_VERSION, flowStateOf, resumeStep } from "@/lib/onboarding/flow";
import { supabaseEnv } from "@/lib/supabase/env";
import { WelcomeForm } from "./welcome-form";

export const dynamic = "force-dynamic";

/** The signed-in person's name, if their account has one (the account menu shows the same). */
async function knownName(): Promise<string | null> {
  if (!supabaseEnv()) return null;
  try {
    const { createClient } = await import("@/lib/supabase/server");
    const { data } = await (await createClient()).auth.getUser();
    const meta = data.user?.user_metadata ?? {};
    for (const key of ["full_name", "name"]) {
      const v = meta[key];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
  } catch {
    // no name; ask for it
  }
  return null;
}

/** Step 1 (Welcome), or a list of brands whose setup can be resumed. */
export default async function OnboardingEntryPage() {
  const workspace = await tryWorkspace();
  if (!workspace) {
    return <p className="text-sm text-muted-foreground">Sign in to set up a brand.</p>;
  }

  const brandIds = await listBrandIds();
  const rows = brandIds.length
    ? await db
        .select({ id: brands.id, name: brands.name, status: brands.status, settingsJson: brands.settingsJson, updatedAt: brands.updatedAt })
        .from(brands)
        .where(and(inArray(brands.id, brandIds)))
        .orderBy(desc(brands.updatedAt))
    : [];
  const hasActive = rows.some((r) => r.status === "active");
  const drafts = rows.filter((r) => r.status === "draft");

  // Someone who left mid-way with nothing live yet goes straight back to where they were.
  const inFlow = drafts.find((d) => flowStateOf(d.settingsJson).flow === FLOW_VERSION);
  if (!hasActive && inFlow) redirect(`/onboarding/${inFlow.id}?step=${resumeStep(flowStateOf(inFlow.settingsJson))}`);

  const name = await knownName();

  return (
    <div className="mx-auto max-w-xl space-y-6">
      {drafts.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Continue setup</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {drafts.map((d) => {
              const step = resumeStep(flowStateOf(d.settingsJson));
              return (
                <div key={d.id} className="flex items-center justify-between rounded-md border p-3">
                  <div>
                    <div className="text-sm font-medium">{d.name}</div>
                    <div className="text-xs text-muted-foreground">
                      Step {step} of {FLOW_STEP_COUNT} · last updated {new Date(d.updatedAt).toLocaleString()}
                    </div>
                  </div>
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/onboarding/${d.id}?step=${step}`}>
                      Resume
                      <ArrowRight className="ml-1 h-3.5 w-3.5" aria-hidden="true" />
                    </Link>
                  </Button>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}
      <WelcomeForm knownName={name} firstBrand={!hasActive} />
    </div>
  );
}
