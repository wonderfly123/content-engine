/**
 * Local bootstrap: create (or reuse) a brand and connect its Instagram account
 * and Facebook Page using a Page access token that already lives in the macOS Keychain.
 * The token is read at runtime and stored encrypted in channel_connections;
 * it is never printed or written to a file.
 *
 * Usage:
 *   npx tsx scripts/connect-instagram-local.ts <slug> "<name>" <ig_user_id> <fb_page_id> <keychain-service>
 */
import { execFileSync } from "node:child_process";
import { config as loadEnv } from "dotenv";

async function main(): Promise<void> {
  loadEnv({ path: ".env.local", quiet: true });
  const [, , slug, name, igUserId, fbPageId, service] = process.argv;
  if (!slug || !name || !/^\d+$/.test(igUserId ?? "") || !/^\d+$/.test(fbPageId ?? "") || !service) {
    console.error('Usage: connect-instagram-local.ts <slug> "<name>" <ig_user_id> <fb_page_id> <keychain-service>');
    process.exit(1);
  }
  const token = execFileSync("security", ["find-generic-password", "-s", service, "-w"], { encoding: "utf8" }).trim();
  if (!token) throw new Error(`Keychain item ${service} is empty`);

  const { db, schema } = await import("@/lib/db");
  const { and, eq } = await import("drizzle-orm");

  let [brand] = await db.select().from(schema.brands).where(eq(schema.brands.slug, slug)).limit(1);
  if (!brand) {
    [brand] = await db.insert(schema.brands).values({ name, slug, status: "active" }).returning();
    console.log(`created brand ${brand.name} (${brand.id})`);
  } else {
    console.log(`brand exists: ${brand.name} (${brand.id})`);
  }

  const connections = [
    { channel: "instagram" as const, externalAccountId: igUserId },
    { channel: "facebook" as const, externalAccountId: fbPageId },
  ];
  for (const { channel, externalAccountId } of connections) {
    const values = {
      brandId: brand.id,
      channel,
      externalAccountId,
      accessToken: token,
      status: "connected" as const,
      metaJson: { igBusinessId: igUserId, fbPageId },
    };
    const existing = await db
      .select({ id: schema.channelConnections.id })
      .from(schema.channelConnections)
      .where(and(eq(schema.channelConnections.brandId, brand.id), eq(schema.channelConnections.channel, channel)))
      .limit(1);
    if (existing[0]) {
      await db.update(schema.channelConnections).set(values).where(eq(schema.channelConnections.id, existing[0].id));
      console.log(`updated ${channel} connection`);
    } else {
      await db.insert(schema.channelConnections).values(values);
      console.log(`created ${channel} connection`);
    }
  }
}

main().then(() => process.exit(0)).catch((err) => { console.error((err as Error).message); process.exit(1); });
