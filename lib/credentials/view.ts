/**
 * The caller's connections, shaped for the Connections card. Holds statuses only, never a key.
 * Returns null when the caller has no workspace.
 */
import { tryWorkspace } from "@/lib/auth/workspace";
import { listCredentials, PROVIDER_INFO } from "./store";

export interface ConnectionView {
  canEdit: boolean;
  /** Required services that are not connected, or connected but failing. */
  needsAttention: Array<{ provider: string; name: string; reason: "missing" | "failing" }>;
  items: Array<{
    provider: string;
    name: string;
    usedFor: string;
    required: boolean;
    getKeyUrl: string;
    connected: boolean;
    status: "ok" | "failing" | null;
    lastCheckError: string | null;
  }>;
}

export async function connectionsForCaller(): Promise<ConnectionView | null> {
  const access = await tryWorkspace();
  if (!access) return null;
  const items = (await listCredentials(access.workspaceId)).map((c) => ({
    provider: c.provider,
    ...PROVIDER_INFO[c.provider],
    connected: c.connected,
    status: c.status,
    lastCheckError: c.lastCheckError,
  }));
  const needsAttention: ConnectionView["needsAttention"] = [];
  for (const i of items) {
    if (i.connected && i.status === "failing") needsAttention.push({ provider: i.provider, name: i.name, reason: "failing" });
    else if (!i.connected && i.required) needsAttention.push({ provider: i.provider, name: i.name, reason: "missing" });
  }
  return { canEdit: access.role === "owner", items, needsAttention };
}
