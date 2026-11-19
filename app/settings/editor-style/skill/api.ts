import type { SkillFileView, SkillVersionView } from "@/lib/editor/skill-files";

export type SkillChange =
  | { action: "save"; path: string; content: string; note?: string }
  | { action: "restore"; path: string; versionId: string }
  | { action: "reset"; path: string };

/** The editable files (GET), or the files after one change (POST). */
export async function skillRequest(change?: SkillChange): Promise<SkillFileView[]> {
  const res = await fetch("/api/admin/skill", change
    ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(change) }
    : { cache: "no-store" });
  const json = (await res.json().catch(() => ({}))) as { files?: SkillFileView[]; error?: string };
  if (!res.ok || !json.files) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json.files;
}

export async function historyRequest(path: string): Promise<SkillVersionView[]> {
  const res = await fetch(`/api/admin/skill/history?path=${encodeURIComponent(path)}`, { cache: "no-store" });
  const json = (await res.json().catch(() => ({}))) as { versions?: SkillVersionView[]; error?: string };
  if (!res.ok || !json.versions) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json.versions;
}
