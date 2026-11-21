/**
 * Each workspace's own keys for outside services (Anthropic, and optionally Epidemic Sound).
 *
 * Secrets are encrypted at rest (the `secret` column) and decrypted only here, on the server, at
 * the moment of use. Nothing in this file returns a secret to a caller that could send it to the
 * browser: `listCredentials` reports only whether a key is set and whether it works.
 */
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { credentialProviderValues, type CredentialProvider } from "@/lib/db/enums";

export const PROVIDERS = credentialProviderValues;

export const PROVIDER_INFO: Record<CredentialProvider, { name: string; usedFor: string; required: boolean; getKeyUrl: string; steps: string[] }> = {
  anthropic: {
    name: "Anthropic (Claude)",
    usedFor: "The video editor, brand analysis, briefs and drafts. Your workspace pays for its own AI use with this key.",
    required: true,
    getKeyUrl: "https://console.anthropic.com/settings/keys",
    steps: [
      "Open the Anthropic Console and sign in, or create an account.",
      "Under Billing, add a payment method or buy credit. Anthropic bills you directly for what your editor uses.",
      "Optional but recommended: set a monthly spend limit, so your AI costs can never run past it.",
      "Under API keys, create a key and name it \"Nekter\".",
      "Copy the key, paste it into the box above, and press Test and save. You won't see it again after saving.",
    ],
  },
  epidemic_sound: {
    name: "Epidemic Sound",
    usedFor: "Optional. Lets the video editor search your Epidemic Sound account for music and use tracks your subscription covers. Tracks it uses are added to the brand's music library.",
    required: false,
    getKeyUrl: "https://www.epidemicsound.com/account/api-keys",
    steps: [
      "Sign in to Epidemic Sound with the account that holds your subscription. Downloading tracks needs a paid plan.",
      "Open Account > API keys and create an MCP Server API key. This is not the Developer Portal key.",
      "Copy the key, paste it into the box above, and press Test and save. You won't see it again after saving.",
      "The key lasts one year. When it expires, create a new one on the same page and paste it here.",
    ],
  },
};

/** Thrown when a feature needs a key the workspace has not connected. */
export class MissingCredentialError extends Error {
  readonly code = "not_connected";
  constructor(public readonly provider: CredentialProvider) {
    super(`${PROVIDER_INFO[provider].name} is not connected. Add your key in Settings > Connections.`);
    this.name = "MissingCredentialError";
  }
}

/** The body of a 409 answer for a feature whose key is missing. */
export function notConnectedBody(provider: CredentialProvider) {
  return { error: "not_connected", provider, message: new MissingCredentialError(provider).message, connectUrl: "/settings?tab=integrations" };
}

export interface CredentialStatus {
  provider: CredentialProvider;
  connected: boolean;
  status: "ok" | "failing" | null;
  lastCheckedAt: string | null;
  lastCheckError: string | null;
}

const mine = (workspaceId: string, provider: CredentialProvider) =>
  and(eq(schema.workspaceCredentials.workspaceId, workspaceId), eq(schema.workspaceCredentials.provider, provider));

/** The decrypted key, or null when the workspace has not connected this service. Server use only. */
export async function getCredential(workspaceId: string, provider: CredentialProvider): Promise<string | null> {
  const [row] = await db.select({ secret: schema.workspaceCredentials.secret }).from(schema.workspaceCredentials).where(mine(workspaceId, provider)).limit(1);
  return row?.secret ?? null;
}

/** The decrypted key for the workspace that owns `brandId`, or null. Server use only. */
export async function getCredentialForBrand(brandId: string, provider: CredentialProvider): Promise<string | null> {
  const [row] = await db
    .select({ secret: schema.workspaceCredentials.secret })
    .from(schema.workspaceCredentials)
    .innerJoin(schema.brands, eq(schema.brands.workspaceId, schema.workspaceCredentials.workspaceId))
    .where(and(eq(schema.brands.id, brandId), eq(schema.workspaceCredentials.provider, provider)))
    .limit(1);
  return row?.secret ?? null;
}

export async function saveCredential(workspaceId: string, provider: CredentialProvider, secret: string): Promise<void> {
  const now = new Date();
  await db
    .insert(schema.workspaceCredentials)
    .values({ workspaceId, provider, secret, status: "ok", lastCheckedAt: now, lastCheckError: null })
    .onConflictDoUpdate({
      target: [schema.workspaceCredentials.workspaceId, schema.workspaceCredentials.provider],
      set: { secret, status: "ok", lastCheckedAt: now, lastCheckError: null, updatedAt: now },
    });
}

export async function removeCredential(workspaceId: string, provider: CredentialProvider): Promise<void> {
  await db.delete(schema.workspaceCredentials).where(mine(workspaceId, provider));
}

/** Records the result of a health check. */
export async function recordCredentialCheck(workspaceId: string, provider: CredentialProvider, error: string | null): Promise<void> {
  await db
    .update(schema.workspaceCredentials)
    .set({ status: error ? "failing" : "ok", lastCheckedAt: new Date(), lastCheckError: error })
    .where(mine(workspaceId, provider));
}

/** What the browser may know: one entry per service, never the secret. */
export async function listCredentials(workspaceId: string): Promise<CredentialStatus[]> {
  const rows = await db
    .select({
      provider: schema.workspaceCredentials.provider,
      status: schema.workspaceCredentials.status,
      lastCheckedAt: schema.workspaceCredentials.lastCheckedAt,
      lastCheckError: schema.workspaceCredentials.lastCheckError,
    })
    .from(schema.workspaceCredentials)
    .where(eq(schema.workspaceCredentials.workspaceId, workspaceId));
  return PROVIDERS.map((provider) => {
    const row = rows.find((r) => r.provider === provider);
    return {
      provider,
      connected: Boolean(row),
      status: row ? (row.status === "failing" ? "failing" : "ok") : null,
      lastCheckedAt: row?.lastCheckedAt?.toISOString() ?? null,
      lastCheckError: row?.lastCheckError ?? null,
    };
  });
}
