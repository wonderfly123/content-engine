import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

// Server component: reads process.env to surface configured/missing badges,
// but never leaks the values themselves.
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

function PlaceholderTab({ title, description, comingIn }: { title: string; description: string; comingIn: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">Form coming in {comingIn}.</p>
      </CardContent>
    </Card>
  );
}

export default function SettingsPage() {
  const statuses = envStatuses();

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Settings</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          App preferences and per-brand configuration. Brand tabs operate on the active brand.
        </p>
      </div>

      <Tabs defaultValue="app">
        <TabsList className="flex flex-wrap">
          <TabsTrigger value="app">App</TabsTrigger>
          <TabsTrigger value="persona">Persona &amp; Voice</TabsTrigger>
          <TabsTrigger value="icps">ICPs</TabsTrigger>
          <TabsTrigger value="competitors">Competitors</TabsTrigger>
          <TabsTrigger value="inspiration">Inspiration</TabsTrigger>
          <TabsTrigger value="keywords">Keywords</TabsTrigger>
          <TabsTrigger value="cadence">Cadence</TabsTrigger>
          <TabsTrigger value="channels">Channels</TabsTrigger>
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
              <ul className="divide-y">
                {statuses.map((s) => (
                  <li key={s.key} className="flex items-center justify-between py-2 text-sm">
                    <span className="font-mono text-xs text-muted-foreground">{s.key}</span>
                    <div className="flex items-center gap-3">
                      <span className="hidden text-sm text-muted-foreground sm:inline">{s.label}</span>
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

          <Card>
            <CardHeader>
              <CardTitle>LLM provider</CardTitle>
              <CardDescription>Default provider + per-task overrides.</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Configuration UI coming in Task 6 (LLM adapter + brief generation).
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="persona" className="pt-4">
          <PlaceholderTab
            title="Persona & Voice"
            description="Mission, audience summary, archetype, POV, traits; voice tone sliders, emoji/hashtag policy, banned words, signature phrases, freeform description, example posts."
            comingIn="Task 5 (Onboarding wizard, Step 3)"
          />
        </TabsContent>

        <TabsContent value="icps" className="pt-4">
          <PlaceholderTab
            title="ICPs"
            description="List + add / edit / delete (max 3). Each ICP: name, description, pain points, where they hang out, content they engage with."
            comingIn="Task 5 (Onboarding, Step 4)"
          />
        </TabsContent>

        <TabsContent value="competitors" className="pt-4">
          <PlaceholderTab
            title="Competitors"
            description="List + add / edit / delete. Handle, platform, URL, notes, pull-window days."
            comingIn="Task 5 (Onboarding, Step 5)"
          />
        </TabsContent>

        <TabsContent value="inspiration" className="pt-4">
          <PlaceholderTab
            title="Inspiration"
            description="Accounts you want briefs to learn from (without copying)."
            comingIn="Task 5 (Onboarding, Step 5)"
          />
        </TabsContent>

        <TabsContent value="keywords" className="pt-4">
          <PlaceholderTab
            title="Keywords"
            description="List + add / pause / delete. Manual 'Pull now' per keyword."
            comingIn="Task 14 (Research pipeline)"
          />
        </TabsContent>

        <TabsContent value="cadence" className="pt-4">
          <PlaceholderTab
            title="Cadence"
            description="Per-channel / per-format frequency sliders. Default Growth = 5 Reels + 2 Carousels per week."
            comingIn="Task 5 (Onboarding, Step 6)"
          />
        </TabsContent>

        <TabsContent value="channels" className="pt-4">
          <PlaceholderTab
            title="Channels"
            description="OAuth connect / disconnect / reconnect for Instagram and Facebook. Other channels greyed."
            comingIn="Task 9 (Meta OAuth + Publisher)"
          />
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
