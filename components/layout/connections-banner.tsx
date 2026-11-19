import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { connectionsForCaller } from "@/lib/credentials/view";

/** Shown across the app when a required key is missing or has stopped working, with the way to fix it. */
export async function ConnectionsBanner() {
  const view = await connectionsForCaller().catch(() => null);
  if (!view || view.needsAttention.length === 0) return null;
  const missing = view.needsAttention.filter((n) => n.reason === "missing").map((n) => n.name);
  const failing = view.needsAttention.filter((n) => n.reason === "failing").map((n) => n.name);
  return (
    <div className="flex items-center gap-2 border-b bg-amber-50 px-6 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100" role="status">
      <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span>
        {missing.length > 0 && <>{missing.join(", ")} is not connected, so brand analysis, briefs and drafts are switched off. </>}
        {failing.length > 0 && <>{failing.join(", ")} stopped working. </>}
        <Link href="/settings?tab=integrations" className="font-medium underline underline-offset-4">
          {view.canEdit ? "Connect in Settings" : "Ask the workspace owner to connect it"}
        </Link>
      </span>
    </div>
  );
}
