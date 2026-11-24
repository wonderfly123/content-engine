/**
 * Turning a cut's draft voice-over script into text an AI voice can read.
 *
 * The editor's draft is a prompt for the reviewer, not narration: an ANGLE line, a SCRIPT section with
 * [brackets] for facts only the reviewer knows, then QUESTIONS. Only the SCRIPT section is meant to be spoken.
 */

export const MAX_SPOKEN_CHARS = 2000;

/** The lines meant to be spoken: the SCRIPT section when the draft has headings, otherwise the whole draft. */
export function speakableScript(script: string | undefined): string {
  const lines = (script ?? "").split("\n");
  const heading = (line: string) => /^[A-Z][A-Z ]+(:| \(|$)/.exec(line.trim())?.[0];
  const start = lines.findIndex((l) => /^SCRIPT\b/.test(l.trim()));
  let body = lines;
  if (start >= 0) {
    const rest = lines.slice(start + 1);
    const end = rest.findIndex((l) => heading(l));
    body = end >= 0 ? rest.slice(0, end) : rest;
  } else {
    body = lines.filter((l) => !heading(l));
  }
  return body.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Placeholders the reviewer still has to fill in, e.g. "[how long]". */
export function unfilledBrackets(text: string): string[] {
  return text.match(/\[[^\]\n]*\]/g) ?? [];
}

/** Why this text cannot be spoken yet, or null when it can. */
export function spokenTextProblem(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return "Write what the voice should say first.";
  if (trimmed.length > MAX_SPOKEN_CHARS) return `That is too long for one voice-over (${MAX_SPOKEN_CHARS} characters at most).`;
  const open = unfilledBrackets(trimmed);
  if (open.length) return `Fill in or remove ${open.length === 1 ? "the bracket" : "the brackets"} first: ${open.slice(0, 3).join(" ")}`;
  return null;
}
