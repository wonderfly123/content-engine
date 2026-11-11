import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { brands } from "@/lib/db/schema";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Step3ReviewProfile } from "@/app/onboarding/[brandId]/steps/3-review-profile";
import { Step4Icps } from "@/app/onboarding/[brandId]/steps/4-icps";
import { Step5CompetitorsInspiration } from "@/app/onboarding/[brandId]/steps/5-competitors-inspiration";
import { Step6Cadence } from "@/app/onboarding/[brandId]/steps/6-cadence";
import { Step7Channels } from "@/app/onboarding/[brandId]/steps/7-channels";
import { resolveEnabledChannels } from "@/lib/analytics/filters";
import type { BrandSettings } from "@/lib/db/types";
import { KeywordsTab } from "./keywords-tab";
import { AnalyticsVisibilityCard } from "./analytics-visibility-card";

export const dynamic = "force-dynamic";

const ENV_VARS = [
  { key: "DATABASE_URL", label: "Neon Postgres (DATABASE_URL)" },
  { key: "BASIC_AUTH_USER", label: "Basic Auth user" },
  { key: "BASIC_AUTH_PASSWORD", label: "Basic Auth password" },
  { key: "TOKEN_ENCRYPTION_KEY", label: "Token encryption key" },
  { key: "ANTHROPIC_API_KEY", label: "Anthropic API key" },
  { key: "FIRECRAWL_API_KEY", label: "Firecrawl API key" },
  { key: "APIFY_TOKEN", label: "Apify token" },
  { key: "META_APP_ID", label: "Meta App ID" },
  { key: "META_APP_SECRET", label: "Meta App secret" },
  { key: "META_REDIRECT_URI", label: "Meta redirect URI" },
  { key: "BLOB_READ_WRITE_TOKEN", label: "Vercel Blob token" },
  { key: "CRON_SECRET", label: "Cron shared secret" },
] as const;

function envStatuses(): { key: string; label: string; configured: boolean }[] {
  return ENV_VARS.map((v) => ({
    key: v.key,
    label: v.label,
    configured: Boolean(process.env[v.key]?.length),
  }));
}

interface SettingsPageProps {
  searchParams?: Promise<{ brandId?: string; tab?: string }>;
}

export default async function SettingsPage({ searchParams }: SettingsPageProps) {
  const sp = (await searchParams) ?? {};
  const statuses = envStatuses();

  // Resolve a brand to operate on. Prefer ?brandId=; fall back to first active.
  let activeBrand:
    | (typeof brands.$inferSelect & { _exists: true })
    | null = null;
  try {
    if (sp.brandId && /^[0-9a-f-]{36}$/i.test(sp.brandId)) {
      const [row] = await db
        .select()
        .from(brands)
        .where(eq(brands.id, sp.brandId));
      if (row) activeBrand = { ...row, _exists: true };
    }
    if (!activeBrand) {
      const [row] = await db
        .select()
        .from(brands)
        .where(eq(brands.status, "active"))
        .orderBy(desc(brands.updatedAt))
        .limit(1);
      if (row) activeBrand = { ...row, _exists: true };
    }
  } catch {
    // DB not reachable (e.g. build-time without env). Render env tab only.
  }

  const defaultTab = sp.tab ?? "app";

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Settings</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            App preferences and per-brand configuration. Brand tabs operate on{" "}
            <strong>{activeBrand?.name ?? "no brand"}</strong>.
          </p>
        </div>
      </div>

      <Tabs defaultValue={defaultTab}>
        <TabsList className="flex flex-wrap">
          <TabsTrigger value="app">App</TabsTrigger>
          <TabsTrigger value="persona" disabled={!activeBrand}>
            Persona &amp; Voice
          </TabsTrigger>
          <TabsTrigger value="icps" disabled={!activeBrand}>ICPs</TabsTrigger>
          <TabsTrigger value="competitors" disabled={!activeBrand}>
            Competitors
          </TabsTrigger>
          <TabsTrigger value="inspiration" disabled={!activeBrand}>
            Inspiration
          </TabsTrigger>
          <TabsTrigger value="keywords" disabled={!activeBrand}>
            Keywords
          </TabsTrigger>
          <TabsTrigger value="cadence" disabled={!activeBrand}>Cadence</TabsTrigger>
          <TabsTrigger value="channels" disabled={!activeBrand}>Channels</TabsTrigger>
          <TabsTrigger value="integrations">Integrations</TabsTrigger>
        </TabsList>

        <TabsContent value="app" className="space-y-4 pt-4">
          <Card>
            <CardHeader>
              <CardTitle>Appearance</CardTitle>
              <CardDescription>
                Use the toggle in the top bar to switch between light, dark, and system themes.
              </CardDescription>
            </CardHeader>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Environment configuration</CardTitle>
              <CardDescription>
                Source of truth: Vercel env vars. Values are never displayed — only configured /
                missing status.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="divide-y" role="list">
                {statuses.map((s) => (
                  <li
                    key={s.key}
                    className="flex items-center justify-between py-2 text-sm"
                  >
                    <span className="font-mono text-xs text-muted-foreground">
                      {s.key}
                    </span>
                    <div className="flex items-center gap-3">
                      <span className="hidden text-sm text-muted-foreground sm:inline">
                        {s.label}
                      </span>
                      {s.configured ? (
                        <Badge variant="default">Configured</Badge>
                      ) : (
                        <Badge variant="destructive">Missing</Badge>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Separator />

          {!activeBrand && (
            <Card>
              <CardHeader>
                <CardTitle>No brand selected</CardTitle>
                <CardDescription>
                  Activate a brand to access per-brand settings. {" "}
                  <Link href="/onboarding" className="underline">
                    Add a brand
                  </Link>
                  .
                </CardDescription>
              </CardHeader>
            </Card>
          )}
        </TabsContent>

        {activeBrand && (
          <>
            <TabsContent value="persona" className="pt-4">
              <Step3ReviewProfile brand={activeBrand} />
            </TabsContent>

            <TabsContent value="icps" className="pt-4">
<Step4Icps brand={activeBrand} />
            </TabsContent>

            <TabsContent value="competitors" className="pt-4">
<Step5CompetitorsInspiration brand={activeBrand} />
            </TabsContent>

            <TabsContent value="inspiration" className="pt-4">
<Step5CompetitorsInspiration brand={activeBrand} />
            </TabsContent>

            <TabsContent value="keywords" className="pt-4">
              <KeywordsTab brandId={activeBrand.id} />
            </TabsContent>

            <TabsContent value="cadence" className="pt-4">
<Step6Cadence brand={activeBrand} />
            </TabsContent>

            <TabsContent value="channels" className="space-y-4 pt-4">
<Step7Channels brand={activeBrand} />
              <AnalyticsVisibilityCard
                brandId={activeBrand.id}
                initialEnabled={resolveEnabledChannels(
                  activeBrand.settingsJson as BrandSettings | null,
                )}
              />
            </TabsContent>
          </>
        )}

        <TabsContent value="integrations" className="pt-4">
          <Card>
            <CardHeader>
              <CardTitle>Integrations</CardTitle>
              <CardDescription>Google Drive / Dropbox bidirectional sync.</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">Coming soon.</p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
