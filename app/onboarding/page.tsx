import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { AccessError, listBrandIds } from "@/lib/auth/workspace";
import { db } from "@/lib/db";
import { brands } from "@/lib/db/schema";
import { and, desc, eq, inArray } from "drizzle-orm";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StartForm } from "./start-form";

export const dynamic = "force-dynamic";

export default async function OnboardingEntryPage() {
  // Only the caller's own unfinished brands. Not signed in / no workspace: none.
  const brandIds = await listBrandIds().catch((err: unknown) => {
    if (err instanceof AccessError) return [] as string[];
    throw err;
  });
  const drafts = brandIds.length === 0 ? [] : await db
    .select({
      id: brands.id,
      name: brands.name,
      slug: brands.slug,
      websiteUrl: brands.websiteUrl,
      settingsJson: brands.settingsJson,
      updatedAt: brands.updatedAt,
    })
    .from(brands)
    .where(and(eq(brands.status, "draft"), inArray(brands.id, brandIds)))
    .orderBy(desc(brands.updatedAt));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Add a brand</h1>
        <p className="text-sm text-muted-foreground">
          We&apos;ll draft a persona, voice, and ICP from a quick description.
        </p>
      </div>

      {drafts.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Continue setup</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {drafts.map((d) => {
              const step =
                (
                  d.settingsJson as { onboarding?: { currentStep?: number } }
                )?.onboarding?.currentStep ?? 1;
              return (
                <div
                  key={d.id}
                  className="flex items-center justify-between rounded-md border p-3"
                >
                  <div>
                    <div className="text-sm font-medium">{d.name}</div>
                    <div className="text-xs text-muted-foreground">
                      Step {step} of 8 · last updated{" "}
                      {new Date(d.updatedAt).toLocaleString()}
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

      <StartForm />
    </div>
  );
}
