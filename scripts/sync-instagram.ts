/**
 * Import every post the connected Instagram accounts have published (skips ones already imported).
 * The daily analytics job does this automatically; run this to do it now.
 *
 * Usage: npx tsx scripts/sync-instagram.ts
 */
import { config as loadEnv } from "dotenv";

async function main(): Promise<void> {
  loadEnv({ path: ".env.local", quiet: true });
  const mod = await import("@/lib/analytics/sync-instagram");
  const { syncAllInstagramMedia } = "syncAllInstagramMedia" in mod ? mod : (mod as unknown as { default: typeof mod }).default;
  for (const r of await syncAllInstagramMedia()) {
    console.log(`brand ${r.brandId}: ${r.found} on Instagram, ${r.imported} imported, ${r.failed} failed`);
  }
}

main().then(() => process.exit(0)).catch((err) => { console.error((err as Error).message); process.exit(1); });
