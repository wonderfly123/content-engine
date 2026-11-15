/**
 * One-off: copy the shared keys from .env.local into a workspace's own stored (encrypted) keys.
 * Usage: npx tsx scripts/import-env-credentials.ts     (WORKSPACE_ID=... when more than one exists)
 * Each key is tested first; a key the service rejects is not stored. Keys are never printed.
 */
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local" });

const ENV: Record<"anthropic" | "firecrawl" | "apify", string> = {
  anthropic: "ANTHROPIC_API_KEY",
  firecrawl: "FIRECRAWL_API_KEY",
  apify: "APIFY_TOKEN",
};

async function main(): Promise<void> {
  const { workspaceForScript } = await import("@/lib/db/script-workspace");
  const { getCredential, saveCredential } = await import("@/lib/credentials/store");
  const { verifyCredential } = await import("@/lib/credentials/verify");
  const workspaceId = await workspaceForScript();

  for (const [provider, name] of Object.entries(ENV) as Array<[keyof typeof ENV, string]>) {
    const value = process.env[name]?.trim();
    if (!value) {
      console.log(`${provider}: ${name} is not set here; skipped`);
      continue;
    }
    if (await getCredential(workspaceId, provider)) {
      console.log(`${provider}: the workspace already has a key; left as it is`);
      continue;
    }
    const check = await verifyCredential(provider, value);
    if (!check.ok && check.rejected) {
      console.log(`${provider}: the service rejected the key in ${name}; not stored`);
      continue;
    }
    await saveCredential(workspaceId, provider, value);
    console.log(`${provider}: stored${check.ok ? " (tested, works)" : ` (could not confirm: ${check.error})`}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
