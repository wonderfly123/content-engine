/**
 * Writes a ready-to-speak voice-over script for a cut, for the AI voice.
 *
 * The editor's draft is a prompt with [brackets] for facts only the reviewer knows; this turns it into
 * finished lines using only what the job already records: the story notes, the reviewer's earlier
 * voice-over transcripts (for facts and for how they talk), the draft itself, and stills from the cut
 * so the lines fit what is on screen.
 */
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { VideoFrame } from "./render";
import { resolveInCuts, type ReelCut } from "./store";
import { MAX_SPOKEN_CHARS } from "./voice-script";

export const SCRIPT_MODEL = "claude-opus-5-5";
const TIMEOUT_MS = 120_000;
// Room for the model to think before it answers; with too little the script stops mid-sentence.
const MAX_TOKENS = 16_000;
const MAX_CONTEXT_CHARS = 6000;
const MAX_GUIDE_CHARS = 40_000;

/** The video skill's folder on this machine (its hook rules), and the repo's copy as a fallback. */
const skillDirs = () => [process.env.VIDEO_SKILL_DIR ?? path.join(os.homedir(), ".claude", "skills", "cutting-montage-videos"), path.join(process.cwd(), "workers", "editor", "skill")];
/** The humanizer skill: the patterns that make text read as AI-written. */
const humanizerFile = () => process.env.HUMANIZER_SKILL_FILE ?? path.join(os.homedir(), ".claude", "skills", "humanizer", "SKILL.md");

async function firstReadable(files: string[]): Promise<string> {
  for (const file of files) {
    const text = await fs.readFile(file, "utf8").catch(() => "");
    if (text.trim()) return text.replace(/^---\n[\s\S]*?\n---\n/, "").trim();
  }
  return "";
}

export interface ScriptSources {
  story: string;
  /** Earlier voice-overs by the reviewer, as plain text. */
  transcripts: string[];
  /** The same hook rules and formulas the editor writes opening text from; the first spoken line follows them. */
  hookRules?: string;
  hookFormulas?: string;
  /** Patterns that make writing sound AI-made, to check the draft against. */
  humanRules?: string;
  /** Stills from the cut, in order, so the lines fit what is on screen. */
  frames?: VideoFrame[];
}

/** Subtitle file to plain speech: drops the counters and timestamps. */
export function srtToText(srt: string): string {
  return srt.split(/\r?\n/).filter((l) => l.trim() && !/^\d+$/.test(l.trim()) && !l.includes("-->")).join(" ").replace(/\s+/g, " ").trim();
}

/** What the job already says about itself. Missing files are simply left out. */
export async function readScriptSources(job: string): Promise<ScriptSources> {
  const story = await fs.readFile(resolveInCuts(job, "story.md"), "utf8").catch(() => "");
  const voDir = resolveInCuts(job, "vo");
  const names = (await fs.readdir(voDir).catch(() => [] as string[])).filter((f) => f.endsWith(".srt")).sort();
  const transcripts: string[] = [];
  for (const name of names) {
    const text = srtToText(await fs.readFile(path.join(voDir, name), "utf8").catch(() => ""));
    if (text) transcripts.push(text);
  }
  const [hookRules, hookFormulas, humanRules] = await Promise.all([
    firstReadable(skillDirs().map((d) => path.join(d, "hooks.md"))),
    firstReadable(skillDirs().map((d) => path.join(d, "hooks-formulas.md"))),
    firstReadable([humanizerFile()]),
  ]);
  return { story: story.trim(), transcripts, hookRules, hookFormulas, humanRules };
}

export function scriptPrompt(cut: Pick<ReelCut, "title" | "seconds" | "script">, sources: ScriptSources): string {
  // About 1.5 spoken words per second leaves room to breathe under music.
  const max = Math.max(15, Math.round(cut.seconds * 1.5));
  const min = Math.round(max * 0.6);
  const part = (label: string, text: string | undefined, cap = MAX_CONTEXT_CHARS) => (text ? `${label}:\n"""\n${text.slice(0, cap)}\n"""\n\n` : "");
  return (
    `Write the voice-over for a ${cut.seconds}-second vertical video titled "${cut.title}". It will be spoken by a clone of the maker's own voice, so it must sound like them talking, in the first person.\n\n` +
    part("What the job is about", sources.story) +
    part("How the maker talks, and facts they have said (their earlier voice-overs)", sources.transcripts.join("\n\n")) +
    part("The editor's draft for this video (angle, starting lines with [brackets] for unknown facts, and questions)", cut.script ?? "") +
    part("Hook rules (the first spoken line must pass these; the on-screen text is written separately, so do not repeat it)", sources.hookRules, MAX_GUIDE_CHARS) +
    part("Hook formulas (structures to borrow for the first line; never paste their wording)", sources.hookFormulas, MAX_GUIDE_CHARS) +
    part("Patterns that make writing sound AI-made. Draft the script, check every line against these, and rewrite until none is left. The maker's earlier voice-overs are the writing sample to match", sources.humanRules, MAX_GUIDE_CHARS) +
    (sources.frames?.length
      ? `The pictures above are stills from this video, in order, each labelled with its time. Use them to know what is on screen when: put each thought near the moment it fits, and never mention something the video does not show. They are not a source of facts: do not guess names, places or numbers from them.\n\n`
      : "") +
    `Rules:\n` +
    `- ${min} to ${max} spoken words. Gaps are fine; music covers them.\n` +
    `- Use only facts stated above. Never invent names, numbers, times, places or opinions. Where the draft has a [bracket] you cannot fill from the facts above, leave that line out or rewrite around it.\n` +
    `- Keep the draft's angle if there is one. Do not describe what the picture already shows.\n` +
    `- Match the maker's register: plain, casual, short sentences, their own turns of phrase. No sales language.\n` +
    `- The first line is the hook: it follows the hook rules above when they are given.\n` +
    `- One sentence per line. A blank line where they would pause between thoughts.\n\n` +
    `Answer with the lines to speak and nothing else: no headings, no brackets, no quotation marks, no notes.`
  );
}

function frameBlocks(frames: VideoFrame[] = []): Array<Record<string, unknown>> {
  return frames.flatMap((f) => [
    { type: "text", text: `At ${f.at}s:` },
    { type: "image", source: { type: "base64", media_type: "image/jpeg", data: f.jpeg.toString("base64") } },
  ]);
}

/** Asks Claude for the script. Throws with a plain message when it cannot be written. */
export async function writeVoiceScript(
  cut: Pick<ReelCut, "title" | "seconds" | "script">,
  sources: ScriptSources,
  key: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const res = await fetchImpl("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    body: JSON.stringify({ model: SCRIPT_MODEL, max_tokens: MAX_TOKENS, messages: [{ role: "user", content: [...frameBlocks(sources.frames), { type: "text", text: scriptPrompt(cut, sources) }] }] }),
  });
  if (!res.ok) throw new Error(`The script could not be written (Claude answered ${res.status}).`);
  const json = (await res.json()) as { content?: Array<{ type: string; text?: string }>; stop_reason?: string };
  if (json.stop_reason === "max_tokens") throw new Error("The script was cut off before it finished. Try again.");
  const text = (json.content?.find((c) => c.type === "text")?.text ?? "")
    .split("\n")
    .map((l) => l.replace(/\[[^\]\n]*\]/g, "").replace(/ {2,}/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_SPOKEN_CHARS);
  if (!text) throw new Error("The script came back empty. Try again.");
  return text;
}
