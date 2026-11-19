import { notFound } from "next/navigation";
import { TriangleAlert } from "lucide-react";
import { getAccess } from "@/lib/auth/session";
import { SkillEditor } from "./skill-editor";

export const dynamic = "force-dynamic";

/** Admin > Editor steps: how the editor scans, cuts, renders and checks, for every brand. The middleware keeps non-admins out; this checks again. */
export default async function AdminEditorStepsPage() {
  const access = await getAccess();
  if (!access || access.status !== "active" || access.role !== "admin") notFound();
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Editor steps</h2>
        <p className="text-sm text-muted-foreground">How the editor works, step by step. Each brand&apos;s taste lives in Settings › Editor style.</p>
      </div>
      <div className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden="true" />
        <p>
          These steps apply to every brand. A mistake here can break every edit until it&apos;s fixed. SKILL.md can&apos;t be saved without its
          out/manifest.json section. Every save is kept, so you can bring an older version back or reset to default.
        </p>
      </div>
      <SkillEditor />
    </div>
  );
}
