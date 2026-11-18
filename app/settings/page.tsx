import Link from "next/link";
import { and, desc, eq, inArray } from "drizzle-orm";
import { listBrandIds, tryBrand } from "@/lib/auth/workspace";
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
import { Step5Cadence } from "@/app/onboarding/[brandId]/steps/5-cadence";
import { Step6Channels } from "@/app/onboarding/[brandId]/steps/6-channels";
import { resolveEnabledChannels } from "@/lib/analytics/filters";
import type { BrandSettings } from "@/lib/db/types";
import { AnalyticsVisibilityCard } from "./analytics-visibility-card";
import { ConnectionsCard } from "@/components/settings/connections-card";
import { getAccess } from "@/lib/auth/session";
import { connectionsForCaller } from "@/lib/credentials/view";
import { PhoneCard } from "@/components/settings/phone-card";
import { phoneForCaller } from "@/lib/conversations/phones";
import { Suspense } from "react";
import { SettingsBrandSync } from "./brand-sync";

export const dynamic = "force-dynamic";

const ENV_VARS = [
  { key: "DATABASE_URL", label: "Neon Postgres (DATABASE_URL)" },
  { key: "BASIC_AUTH_USER", label: "Basic Auth user" },
  { key: "BASIC_AUTH_PASSWORD", label: "Basic Auth password" },
  { key: "TOKEN_ENCRYPTION_KEY", label: "Token encryption key" },
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

const SETTINGS_TABS = ["app", "persona", "icps", "cadence", "channels", "connections", "integrations"];

interface SettingsPageProps {
  searchParams?: Promise<{ brandId?: string; tab?: string }>;
}

export default async function SettingsPage({ searchParams }: SettingsPageProps) {
  const sp = (await searchParams) ?? {};
  const statuses = envStatuses();

  // Resolve a brand to operate on. Prefer ?brandId= (only if it is the caller's);
  // fall back to the caller's most recently updated active brand. The brand tabs
  // below only ever receive this checked brand.
  let activeBrand:
    | (typeof brands.$inferSelect & { _exists: true })
    | null = null;
  try {
    const requested = sp.brandId ? await tryBrand(sp.brandId) : null;
    if (requested) {
      const [row] = await db
        .select()
        .from(brands)
        .where(eq(brands.id, requested.brandId));
      if (row) activeBrand = { ...row, _exists: true };
    }
    const brandIds = activeBrand ? [] : await listBrandIds();
    if (!activeBrand && brandIds.length > 0) {
      const [row] = await db
        .select()
        .from(brands)
        .where(and(eq(brands.status, "active"), inArray(brands.id, brandIds)))
        .orderBy(desc(brands.updatedAt))
        .limit(1);
      if (row) activeBrand = { ...row, _exists: true };
    }
  } catch {
    // DB not reachable (e.g. build-time without env) or not signed in. Render env tab only.
  }

  // The workspace's own keys (statuses only), and whether the caller runs the platform.
  const connections = await connectionsForCaller().catch(() => null);
  const isPlatformAdmin = (await getAccess().catch(() => null))?.role === "admin";
  // The caller's own mobile number, and whether it texts for this brand.
  const phone = activeBrand ? await phoneForCaller(activeBrand.id).catch(() => null) : null;

  // An old link to a tab that no longer exists opens the App tab.
  const defaultTab = sp.tab && SETTINGS_TABS.includes(sp.tab) ? sp.tab : "app";

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

      <Suspense fallback={null}>
        <SettingsBrandSync renderedBrandId={activeBrand?.id ?? null} />
      </Suspense>
      <Tabs defaultValue={defaultTab}>
        <TabsList className="flex flex-wrap">
          <TabsTrigger value="app">App</TabsTrigger>
          <TabsTrigger value="persona" disabled={!activeBrand}>
            Persona &amp; Voice
          </TabsTrigger>
          <TabsTrigger value="icps" disabled={!activeBrand}>ICPs</TabsTrigger>
          <TabsTrigger value="cadence" disabled={!activeBrand}>Cadence</TabsTrigger>
          <TabsTrigger value="channels" disabled={!activeBrand}>Channels</TabsTrigger>
          <TabsTrigger value="connections">Connections</TabsTrigger>
          <TabsTrigger value="integrations">Integrations</TabsTrigger>
        </TabsList>

        <TabsContent value="app" className="space-y-4 pt-4">
          {phone && activeBrand && (
            <PhoneCard
              brandId={activeBrand.id}
              brandName={activeBrand.name}
              status={phone.status}
              textingEnabled={phone.textingEnabled}
              onForBrand={phone.onForBrand}
            />
          )}


          {isPlatformAdmin && (
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
          )}

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

            <TabsContent value="cadence" className="pt-4">
<Step5Cadence brand={activeBrand} />
            </TabsContent>

            <TabsContent value="channels" className="space-y-4 pt-4">
<Step6Channels brand={activeBrand} />
              <AnalyticsVisibilityCard
                brandId={activeBrand.id}
                initialEnabled={resolveEnabledChannels(
                  activeBrand.settingsJson as BrandSettings | null,
                )}
              />
            </TabsContent>
          </>
        )}

        <TabsContent value="connections" className="space-y-4 pt-4">
          <p className="text-sm text-muted-foreground">
            Your workspace runs on its own keys. A key is tested when you save it, stored encrypted, and never shown again.
            Instagram and Facebook are connected per brand under Channels.
          </p>
          {connections ? (
            <ConnectionsCard items={connections.items} canEdit={connections.canEdit} />
          ) : (
            <p className="text-sm text-muted-foreground">Sign in to manage connections.</p>
          )}
        </TabsContent>

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
