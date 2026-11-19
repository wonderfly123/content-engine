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
import { Step3ReviewProfile } from "@/app/onboarding/[brandId]/steps/3-review-profile";
import { Step4Icps } from "@/app/onboarding/[brandId]/steps/4-icps";
import { Step6Channels } from "@/app/onboarding/[brandId]/steps/6-channels";
import { ConnectionsCard } from "@/components/settings/connections-card";
import { connectionsForCaller } from "@/lib/credentials/view";
import { PhoneCard } from "@/components/settings/phone-card";
import { phoneForCaller } from "@/lib/conversations/phones";
import { Suspense } from "react";
import { SettingsBrandSync } from "./brand-sync";
import { EditorStyle } from "./editor-style/editor-style";
import { MusicLibrary } from "./music/music-library";
import { StorageSettings } from "./storage/storage-settings";

export const dynamic = "force-dynamic";

const SETTINGS_TABS = ["persona", "icps", "editor-style", "music", "storage", "integrations"];
/** Tabs that were folded into Integrations; old links to them still land there. */
const MOVED_TO_INTEGRATIONS = ["app", "connections", "channels"];

interface SettingsPageProps {
  searchParams?: Promise<{ brandId?: string; tab?: string }>;
}

export default async function SettingsPage({ searchParams }: SettingsPageProps) {
  const sp = (await searchParams) ?? {};

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
    // DB not reachable (e.g. build-time without env) or not signed in. Render Integrations only.
  }

  // The workspace's own keys (statuses only), and whether the caller runs the platform.
  const connections = await connectionsForCaller().catch(() => null);
  // The caller's own mobile number, and whether it texts for this brand.
  const phone = activeBrand ? await phoneForCaller(activeBrand.id).catch(() => null) : null;

  // An old link to a tab that no longer exists opens the first tab.
  const requestedTab = sp.tab && MOVED_TO_INTEGRATIONS.includes(sp.tab) ? "integrations" : sp.tab;
  const fallbackTab = activeBrand ? "persona" : "integrations";
  const defaultTab = requestedTab && SETTINGS_TABS.includes(requestedTab) ? requestedTab : fallbackTab;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Settings</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Brand profile and integrations. Brand tabs operate on{" "}
            <strong>{activeBrand?.name ?? "no brand"}</strong>.
          </p>
        </div>
      </div>

      <Suspense fallback={null}>
        <SettingsBrandSync renderedBrandId={activeBrand?.id ?? null} />
      </Suspense>
      {!activeBrand && (
        <Card>
          <CardHeader>
            <CardTitle>No brand selected</CardTitle>
            <CardDescription>
              Activate a brand to access per-brand settings.{" "}
              <Link href="/onboarding" className="underline">
                Add a brand
              </Link>
              .
            </CardDescription>
          </CardHeader>
        </Card>
      )}
      <Tabs defaultValue={defaultTab}>
        <TabsList className="flex flex-wrap">
          <TabsTrigger value="persona" disabled={!activeBrand}>
            Persona &amp; Voice
          </TabsTrigger>
          <TabsTrigger value="icps" disabled={!activeBrand}>ICPs</TabsTrigger>
          <TabsTrigger value="editor-style" disabled={!activeBrand}>Editor style</TabsTrigger>
          <TabsTrigger value="music" disabled={!activeBrand}>Music</TabsTrigger>
          <TabsTrigger value="storage" disabled={!activeBrand}>Storage</TabsTrigger>
          <TabsTrigger value="integrations">Integrations</TabsTrigger>
        </TabsList>

        {activeBrand && (
          <>
            <TabsContent value="persona" className="pt-4">
              <Step3ReviewProfile brand={activeBrand} />
            </TabsContent>

            <TabsContent value="icps" className="pt-4">
<Step4Icps brand={activeBrand} />
            </TabsContent>

            <TabsContent value="editor-style" className="pt-4">
              <EditorStyle key={activeBrand.id} brandId={activeBrand.id} brandName={activeBrand.name} />
            </TabsContent>

            <TabsContent value="music" className="pt-4">
              <MusicLibrary key={activeBrand.id} brandId={activeBrand.id} />
            </TabsContent>

            <TabsContent value="storage" className="pt-4">
              <StorageSettings key={activeBrand.id} brandId={activeBrand.id} />
            </TabsContent>

          </>
        )}

        <TabsContent value="integrations" className="space-y-4 pt-4">
          {phone && activeBrand && (
            <PhoneCard
              brandId={activeBrand.id}
              brandName={activeBrand.name}
              status={phone.status}
              textingEnabled={phone.textingEnabled}
              onForBrand={phone.onForBrand}
            />
          )}
          <p className="text-sm text-muted-foreground">
            Your workspace runs on its own keys. A key is tested when you save it, stored encrypted, and never shown again.
          </p>
          {activeBrand && <Step6Channels brand={activeBrand} />}
          {connections ? (
            <ConnectionsCard items={connections.items} canEdit={connections.canEdit} />
          ) : (
            <p className="text-sm text-muted-foreground">Sign in to manage connections.</p>
          )}
          <Card>
            <CardHeader>
              <CardTitle>Google Drive / Dropbox</CardTitle>
              <CardDescription>Two-way sync with your cloud folders.</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">Coming soon.</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Epidemic Sound</CardTitle>
              <CardDescription>
                Connect your own Epidemic Sound account so the editor can use the music your subscription covers.
              </CardDescription>
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
