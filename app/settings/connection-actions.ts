"use server";

/**
 * Connect, replace or remove one of the workspace's own keys (Anthropic, Firecrawl, Apify).
 * A key is tested against its service before it is stored, and is never sent back to the browser.
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { tryWorkspace } from "@/lib/auth/workspace";
import { removeCredential, saveCredential } from "@/lib/credentials/store";
import { verifyCredential } from "@/lib/credentials/verify";
import { credentialProviderValues } from "@/lib/db/enums";

export type ConnectionResult = { ok: true } | { ok: false; error: string };

const saveSchema = z.object({
  provider: z.enum(credentialProviderValues),
  secret: z.string().trim().min(8, "That key looks too short.").max(500),
});
const removeSchema = z.object({ provider: z.enum(credentialProviderValues) });

async function ownerWorkspace(): Promise<{ workspaceId: string } | { error: string }> {
  const access = await tryWorkspace();
  if (!access) return { error: "Sign in to manage connections." };
  if (access.role !== "owner") return { error: "Only the workspace owner can change connections." };
  return { workspaceId: access.workspaceId };
}

function refresh(): void {
  revalidatePath("/settings");
  revalidatePath("/onboarding");
  revalidatePath("/", "layout");
}

export async function saveConnection(input: { provider: string; secret: string }): Promise<ConnectionResult> {
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid key." };
  const owner = await ownerWorkspace();
  if ("error" in owner) return { ok: false, error: owner.error };

  const check = await verifyCredential(parsed.data.provider, parsed.data.secret);
  if (!check.ok) return { ok: false, error: check.error };

  await saveCredential(owner.workspaceId, parsed.data.provider, parsed.data.secret);
  refresh();
  return { ok: true };
}

export async function removeConnection(input: { provider: string }): Promise<ConnectionResult> {
  const parsed = removeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Unknown service." };
  const owner = await ownerWorkspace();
  if ("error" in owner) return { ok: false, error: owner.error };

  await removeCredential(owner.workspaceId, parsed.data.provider);
  refresh();
  return { ok: true };
}
