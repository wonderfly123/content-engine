/**
 * Versions of the editor skill's markdown files (table editor_skill_versions). Platform-wide: only
 * the platform admin edits them (app/api/admin/skill), and every editor job carries the current set
 * (lib/editor/submit.ts -> skillFiles). Saves only ever add rows; restore and reset add one too.
 */
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { SKILL_DEFAULTS } from "./skill-defaults.generated";
import {
  EDITABLE_SKILL_PATHS,
  MAX_SKILL_FILE_BYTES,
  MAX_SKILL_NOTE_CHARS,
  MAX_SKILL_TOTAL_BYTES,
  isSkillPath,
  utf8Bytes,
  type SkillPath,
} from "./skill-files";

const { editorSkillVersions: versions } = schema;

/** A refused change; the message is safe to show. */
export class SkillError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SkillError";
  }
}

export function defaultSkillContent(path: SkillPath): string {
  const text = SKILL_DEFAULTS[path];
  if (typeof text !== "string") throw new Error(`No bundled default for ${path}; run npm run skill:gen.`);
  return text;
}

type Row = typeof versions.$inferSelect;

/** The newest row of each file that has one. */
async function newestRows(): Promise<Map<string, Row>> {
  const rows = await db
    .selectDistinctOn([versions.path])
    .from(versions)
    .orderBy(versions.path, desc(versions.createdAt), desc(versions.id));
  return new Map(rows.map((r) => [r.path, r]));
}

/** The current content of every editable file: its newest version, else the repo copy. */
export async function currentSkillFiles(): Promise<Record<SkillPath, string>> {
  const newest = await newestRows();
  return Object.fromEntries(EDITABLE_SKILL_PATHS.map((p) => [p, newest.get(p)?.content ?? defaultSkillContent(p)])) as Record<SkillPath, string>;
}

/** Every editable file with its current content and whether it differs from the repo copy. */
export async function skillOverview(nameOf: (userId: string) => string = (id) => id) {
  const newest = await newestRows();
  return EDITABLE_SKILL_PATHS.map((path) => {
    const row = newest.get(path);
    const content = row?.content ?? defaultSkillContent(path);
    return {
      path,
      content,
      changed: content !== defaultSkillContent(path),
      updatedAt: row ? row.createdAt.toISOString() : null,
      updatedBy: row ? nameOf(row.createdBy) : null,
    };
  });
}

/** A file's saved versions, newest first. */
export async function skillHistory(path: SkillPath, limit = 100): Promise<Row[]> {
  return db.select().from(versions).where(eq(versions.path, path)).orderBy(desc(versions.createdAt), desc(versions.id)).limit(limit);
}

function checkContent(content: unknown): string {
  if (typeof content !== "string") throw new SkillError("The file's text is missing.");
  if (utf8Bytes(content) > MAX_SKILL_FILE_BYTES) throw new SkillError(`A file can be at most ${MAX_SKILL_FILE_BYTES / 1024} KB.`);
  if (content.includes("\u0000")) throw new SkillError("The file contains a null character.");
  return content;
}

/** Adds a version of `path`. Refuses an unknown path, an oversize file, or a set over the job limit. */
export async function saveSkillVersion(input: { path: unknown; content: unknown; note?: unknown; userId: string }): Promise<Row> {
  if (!isSkillPath(input.path)) throw new SkillError("That is not an editable skill file.");
  const path = input.path;
  const content = checkContent(input.content);
  const noteRaw = typeof input.note === "string" ? input.note.trim() : "";
  if (noteRaw.length > MAX_SKILL_NOTE_CHARS) throw new SkillError(`A note can be at most ${MAX_SKILL_NOTE_CHARS} characters.`);
  const current = await currentSkillFiles();
  const total = EDITABLE_SKILL_PATHS.reduce((n, p) => n + utf8Bytes(p === path ? content : current[p]), 0);
  if (total > MAX_SKILL_TOTAL_BYTES) throw new SkillError(`All the skill files together can be at most ${MAX_SKILL_TOTAL_BYTES / 1024} KB.`);
  const [row] = await db.insert(versions).values({ path, content, note: noteRaw || null, createdBy: input.userId }).returning();
  return row;
}

/** Saves an earlier version of `path` again, as its newest version. */
export async function restoreSkillVersion(input: { path: unknown; versionId: unknown; userId: string }): Promise<Row> {
  if (!isSkillPath(input.path)) throw new SkillError("That is not an editable skill file.");
  if (typeof input.versionId !== "string" || !/^[0-9a-f-]{36}$/i.test(input.versionId)) throw new SkillError("Unknown version.");
  const [old] = await db.select().from(versions).where(and(eq(versions.id, input.versionId), eq(versions.path, input.path))).limit(1);
  if (!old) throw new SkillError("Unknown version.");
  const when = old.createdAt.toISOString().slice(0, 16).replace("T", " ");
  return saveSkillVersion({ path: input.path, content: old.content, note: `Restored the version from ${when} UTC`, userId: input.userId });
}

/** Saves the repo copy of `path` as its newest version. */
export async function resetSkillFile(input: { path: unknown; userId: string }): Promise<Row> {
  if (!isSkillPath(input.path)) throw new SkillError("That is not an editable skill file.");
  return saveSkillVersion({ path: input.path, content: defaultSkillContent(input.path), note: "Reset to default", userId: input.userId });
}
