import type { SectionValue, StyleSectionId } from "@/lib/editor/style-schema";
import type { EditorStyleResponse, StyleVersionView } from "@/lib/editor/style-view";

export type StyleChange =
  | { action: "save"; section: StyleSectionId; value: SectionValue; note?: string }
  | { action: "restore"; section: StyleSectionId; versionId: string }
  | { action: "reset"; section: StyleSectionId };

const base = (brandId: string) => `/api/brands/${encodeURIComponent(brandId)}/editor-style`;

async function read<T>(res: Response, key: keyof T): Promise<T> {
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok || json[key] === undefined) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json;
}

/** The brand's style (GET), or the style after one change (POST). */
export async function styleRequest(brandId: string, change?: StyleChange): Promise<EditorStyleResponse> {
  const res = await fetch(
    base(brandId),
    change ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(change) } : { cache: "no-store" },
  );
  return read<EditorStyleResponse>(res, "sections");
}

export async function styleHistoryRequest(brandId: string, section: StyleSectionId): Promise<StyleVersionView[]> {
  const res = await fetch(`${base(brandId)}/history?section=${section}`, { cache: "no-store" });
  return (await read<{ versions: StyleVersionView[] }>(res, "versions")).versions;
}

export async function decideRequest(brandId: string, suggestionId: string, decision: "accept" | "dismiss"): Promise<EditorStyleResponse> {
  const res = await fetch(`${base(brandId)}/suggestions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ suggestionId, decision }),
  });
  return read<EditorStyleResponse>(res, "sections");
}
