/**
 * Naming a video thread from what the person said it's about: a short title ("Cider stand
 * opening") that every text about it starts with, and a one-line summary for the "Got your clips"
 * reply. Uses the workspace's own Anthropic key; without one (or if the call fails) the title comes
 * from the description's first words, so naming never blocks the edit.
 */
import { getCredential } from "@/lib/credentials/store";

export const NAMING_MODEL = "claude-opus-5-5";
const TIMEOUT_MS = 15_000;

export interface ThreadName {
  title: string;
  summary: string;
}

/** Up to five words of the description, capitalised: the fallback title. */
export function fallbackTitle(description: string, kind: string | null): string {
  const words = description.replace(/[^\p{L}\p{N}'\s-]+/gu, " ").split(/\s+/).filter(Boolean).slice(0, 5);
  if (words.length === 0) return kind === "story" ? "New story" : "New reel";
  const t = words.join(" ");
  return t.charAt(0).toUpperCase() + t.slice(1);
}

const clean = (s: unknown, max: number) => (typeof s === "string" ? s.replace(/\s+/g, " ").replace(/^["'\[]+|["'\]]+$/g, "").trim().slice(0, max) : "");

export async function nameThread(
  input: { workspaceId: string; kind: string | null; brandName: string | null; description: string },
  deps: { fetchImpl?: typeof fetch; key?: string | null } = {},
): Promise<ThreadName> {
  const description = input.description.trim();
  const fallback = { title: fallbackTitle(description, input.kind), summary: description.slice(0, 160) };
  if (!description) return fallback;
  const key = deps.key !== undefined ? deps.key : await getCredential(input.workspaceId, "anthropic").catch(() => null);
  if (!key) return fallback;
  try {
    const res = await (deps.fetchImpl ?? fetch)("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body: JSON.stringify({
        model: NAMING_MODEL,
        max_tokens: 200,
        messages: [
          {
            role: "user",
            content:
              `Name this short ${input.kind ?? "video"}${input.brandName ? ` for ${input.brandName}` : ""} so its maker recognises it in a text message.\n` +
              `What they said it's about: """${description.slice(0, 1500)}"""\n\n` +
              `Answer with JSON only: {"title": "2 to 5 words, Title Case, no quotes or emoji", "summary": "one plain sentence, under 120 characters, saying what the video shows"}`,
          },
        ],
      }),
    });
    if (!res.ok) return fallback;
    const json = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
    const text = json.content?.find((c) => c.type === "text")?.text ?? "";
    const parsed = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as { title?: unknown; summary?: unknown };
    const title = clean(parsed.title, 60);
    const summary = clean(parsed.summary, 160);
    return { title: title || fallback.title, summary: summary || fallback.summary };
  } catch {
    return fallback;
  }
}
