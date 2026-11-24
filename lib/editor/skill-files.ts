/**
 * The editor skill's editable files: the markdown under workers/editor/skill (scripts stay in the
 * repo). Same list as SKILL_FILES in workers/editor/contract.py; a test keeps the two, the folder
 * and the bundled defaults in step. Safe to import from client code.
 */

export const EDITABLE_SKILL_PATHS = ["SKILL.md", "captions.md", "epidemic-sound.md", "hooks-formulas.md", "hooks.md", "intake.md", "profiles/build.md", "profiles/event.md", "profiles/training.md", "review.md"] as const;
export type SkillPath = (typeof EDITABLE_SKILL_PATHS)[number];

/** Largest single save. */
export const MAX_SKILL_FILE_BYTES = 100 * 1024;
/** Largest set of files a job may carry (the worker refuses more). */
export const MAX_SKILL_TOTAL_BYTES = 200 * 1024;
export const MAX_SKILL_NOTE_CHARS = 500;

export function isSkillPath(value: unknown): value is SkillPath {
  return typeof value === "string" && (EDITABLE_SKILL_PATHS as readonly string[]).includes(value);
}

export const utf8Bytes = (text: string): number => new TextEncoder().encode(text).length;

/** One file as Admin lists it. */
export interface SkillFileView {
  path: SkillPath;
  content: string;
  /** True when the current content differs from the repo default. */
  changed: boolean;
  /** The newest saved version, or null while the file has never been saved. */
  updatedAt: string | null;
  updatedBy: string | null;
}

/** One saved version of a file. */
export interface SkillVersionView {
  id: string;
  createdAt: string;
  createdBy: string;
  note: string | null;
  content: string;
  isDefault: boolean;
}
