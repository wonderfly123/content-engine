"use client";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useBrandStore } from "@/lib/stores/brand-store";
import { NeedsReviewCard } from "@/components/dashboard/needs-review-card";
import {
  TodayQueueCard,
  WeekQueueCard,
} from "@/components/dashboard/queue-cards";
import { AlertsCard } from "@/components/dashboard/alerts-card";

export default function DashboardPage() {
  const brand = useBrandStore((s) => s.active);
  const looksLikeUuid =
    typeof brand?.id === "string" && /^[0-9a-f-]{36}$/i.test(brand.id);
  const brandId = looksLikeUuid ? brand!.id : undefined;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Dashboard</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          What needs your attention.
        </p>
      </div>

      {!brandId ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {brand ? "Brand not synced" : "No active brand"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              {brand
                ? "This brand isn't linked to database records yet, so there's nothing to triage."
                : "Pick a brand in the sidebar switcher to see its dashboard."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <NeedsReviewCard brandSlug={brand!.slug} />
          <AlertsCard brandId={brandId} />
          <TodayQueueCard brandId={brandId} />
          <WeekQueueCard brandId={brandId} />
        </div>
      )}
    </div>
  );
}
