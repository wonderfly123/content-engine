/**
 * Upload links for the editor worker's output (POST /api/editor/uploads?job=<id>, Bearer secret).
 * Only a job that is `running` gets links, and every key is derived here, under that job's own
 * prefix in its thread (ws/<ws>/conv/<conv>/preview/<jobId>/<safe name>): the worker names files,
 * never paths.
 */
import { buildPreviewKey, InvalidMediaKeyError } from "@/lib/storage/keys";
import { presignPut } from "@/lib/storage/r2";
import { getJob } from "./jobs";
import { uploadsRequestSchema } from "./manifest";
import { EDITOR_LINK_SECONDS } from "./submit";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface UploadsOutcome {
  status: number;
  body: Record<string, unknown>;
}

export async function issueUploadUrls(jobParam: string | null, payload: unknown): Promise<UploadsOutcome> {
  if (!jobParam || !UUID.test(jobParam)) return { status: 404, body: { error: "unknown_job" } };
  const job = await getJob(jobParam.toLowerCase());
  if (!job) return { status: 404, body: { error: "unknown_job" } };
  if (job.status !== "running") return { status: 409, body: { error: "job_not_running" } };

  const parsed = uploadsRequestSchema.safeParse(payload);
  if (!parsed.success) return { status: 400, body: { error: "invalid", message: "Send 1 to 10 files, each video/mp4 or image/jpeg." } };

  const named: Array<{ name: string; key: string }> = [];
  const seen = new Set<string>();
  for (const f of parsed.data.files) {
    let key: string;
    try {
      key = buildPreviewKey({ workspaceId: job.workspaceId, conversationId: job.conversationId, jobId: job.id, filename: f.name });
    } catch (err) {
      if (err instanceof InvalidMediaKeyError) return { status: 400, body: { error: "invalid_name", name: f.name } };
      throw err;
    }
    if (seen.has(key)) return { status: 400, body: { error: "duplicate_name", name: f.name } };
    seen.add(key);
    named.push({ name: f.name, key });
  }
  // Links only once every name has passed.
  return { status: 200, body: { files: named.map((f) => ({ ...f, putUrl: presignPut(f.key, EDITOR_LINK_SECONDS) })) } };
}
