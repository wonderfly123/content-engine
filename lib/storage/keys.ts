/**
 * The only place that builds storage keys. Every key starts with its workspace:
 *
 *   ws/<workspaceId>/conv/<conversationId>/<kind>/<uuid>-<sanitised filename>
 *   ws/<workspaceId>/conv/<conversationId>/incoming/<uuid>-<sanitised filename>   (holding area: as uploaded)
 *   ws/<workspaceId>/conv/<conversationId>/raw/<uuid>.mp4                         (the optimizer's output)
 *
 * `incoming` is a key area only, not a media kind: an uploaded clip is a `raw` clip wherever its
 * bytes sit, and the optimizer moves it from incoming/ to raw/ (lib/media/optimize.ts).
 *
 * Filenames with path tricks (slashes, backslashes, control characters, "." or "..") are refused;
 * everything else is reduced to letters, digits, ".", "_" and "-".
 */
import { randomUUID } from "node:crypto";
import { mediaKindValues, type MediaKind } from "@/lib/db/enums";

export class InvalidMediaKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidMediaKeyError";
  }
}

const UUID_SRC = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const UUID = new RegExp(`^${UUID_SRC}$`, "i");
/** Where a key's bytes sit: one of the media kinds, or the upload holding area. */
export const INCOMING = "incoming";
export type KeyArea = MediaKind | typeof INCOMING;
const AREAS: readonly string[] = [...mediaKindValues, INCOMING];
const KEY = new RegExp(`^ws/(${UUID_SRC})/conv/(${UUID_SRC})/(${AREAS.join("|")})/${UUID_SRC}(?:-[A-Za-z0-9_][A-Za-z0-9._-]*|\\.mp4)$`, "i");
const MAX_BASE = 100;
const MAX_EXT = 10;

/** A storage-safe version of a file's name, or an error when the name tries to name a path. */
export function sanitiseFilename(name: unknown): string {
  if (typeof name !== "string") throw new InvalidMediaKeyError("A filename is required.");
  const trimmed = name.normalize("NFC").trim();
  if (!trimmed || trimmed.length > 255) throw new InvalidMediaKeyError("The filename is empty or too long.");
  // eslint-disable-next-line no-control-regex
  if (/[/\\\u0000-\u001f\u007f]/.test(trimmed)) throw new InvalidMediaKeyError("Filenames cannot contain slashes or control characters.");
  if (trimmed === "." || trimmed === "..") throw new InvalidMediaKeyError("That is not a filename.");

  const dot = trimmed.lastIndexOf(".");
  const rawBase = dot > 0 ? trimmed.slice(0, dot) : trimmed;
  const rawExt = dot > 0 ? trimmed.slice(dot + 1) : "";
  const base = rawBase
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/\.{2,}/g, ".")
    .replace(/-{2,}/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "")
    .slice(0, MAX_BASE)
    .replace(/[.-]+$/g, "");
  const ext = rawExt.replace(/[^A-Za-z0-9]/g, "").slice(0, MAX_EXT);
  return `${base || "clip"}${ext ? `.${ext}` : ""}`;
}

export interface MediaKeyInput {
  workspaceId: string;
  conversationId: string;
  filename: string;
  kind?: KeyArea;
  /** The object's own id (defaults to a new one); the media row uses the same id. */
  id?: string;
}

export function buildMediaKey({ workspaceId, conversationId, filename, kind = "raw", id = randomUUID() }: MediaKeyInput): string {
  for (const [label, value] of [["workspace", workspaceId], ["conversation", conversationId], ["object", id]] as const) {
    if (typeof value !== "string" || !UUID.test(value)) throw new InvalidMediaKeyError(`Invalid ${label} id.`);
  }
  if (!AREAS.includes(kind)) throw new InvalidMediaKeyError("Invalid media kind.");
  const key = `ws/${workspaceId.toLowerCase()}/conv/${conversationId.toLowerCase()}/${kind}/${id.toLowerCase()}-${sanitiseFilename(filename)}`;
  if (!KEY.test(key)) throw new InvalidMediaKeyError("Could not build a storage key.");
  return key;
}

/** The optimizer's output for one clip: `.../raw/<id>.mp4` (derived, never taken from the worker). */
export function buildOptimizedKey({ workspaceId, conversationId, id }: { workspaceId: string; conversationId: string; id: string }): string {
  for (const [label, value] of [["workspace", workspaceId], ["conversation", conversationId], ["object", id]] as const) {
    if (typeof value !== "string" || !UUID.test(value)) throw new InvalidMediaKeyError(`Invalid ${label} id.`);
  }
  return `ws/${workspaceId.toLowerCase()}/conv/${conversationId.toLowerCase()}/raw/${id.toLowerCase()}.mp4`;
}

/** True for a key in the upload holding area. */
export const isIncomingKey = (key: string): boolean => KEY.exec(key)?.[3]?.toLowerCase() === INCOMING;

/** True only for a well-formed key inside this workspace (checked again before any signing). */
export function isWorkspaceKey(key: unknown, workspaceId: string): key is string {
  if (typeof key !== "string") return false;
  const m = KEY.exec(key);
  return Boolean(m && m[1].toLowerCase() === workspaceId.toLowerCase());
}
