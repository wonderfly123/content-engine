import { ConnectionsCard } from "@/components/settings/connections-card";
import type { ConnectionView } from "@/lib/credentials/view";

/**
 * Step 2: the workspace's own Anthropic key, with the same test-and-save form and 5-step guide as
 * Settings > Connections. Once the key works the page moves on to step 3 by itself.
 */
export function ConnectClaude({ connections }: { connections: ConnectionView }) {
  const items = connections.items.filter((i) => i.provider === "anthropic");
  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h2 className="text-xl font-semibold">Connect Claude</h2>
        <p className="text-sm text-muted-foreground">
          Nekter&apos;s AI runs on Claude, using your own Anthropic key. Your workspace pays Anthropic directly for what it uses;
          Nekter never adds a markup. The brand research in the next steps runs on this key, and so does every video edit.
        </p>
        <p className="text-sm text-muted-foreground">You can set a monthly spend limit in the Anthropic Console, so your AI costs never run past it.</p>
      </header>
      <ConnectionsCard items={items} canEdit={connections.canEdit} />
      {!connections.canEdit && (
        <p className="text-sm text-muted-foreground">Ask the owner of your workspace to add the key in Settings &gt; Connections, then come back here.</p>
      )}
    </div>
  );
}
