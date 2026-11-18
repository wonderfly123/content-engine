/**
 * The editor's steps while it works. The worker (workers/editor/app.py) sends its whole step list
 * every time a new step starts, signed like its result; it replaces what is stored, and only while
 * the job is still running (a late update never touches a finished job).
 */
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/lib/db";

const { editorJobs } = schema;

export const MAX_STEPS = 80;

const progressSchema = z.object({
  jobId: z.string().uuid(),
  steps: z
    .array(z.object({ label: z.string().trim().min(1).max(120), at: z.string().datetime() }))
    .max(MAX_STEPS),
});

export async function applyEditorProgress(payload: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const parsed = progressSchema.safeParse(payload);
  if (!parsed.success) return { status: 400, body: { error: "invalid" } };
  const { jobId, steps } = parsed.data;
  const rows = await db
    .update(editorJobs)
    .set({ progress: steps })
    .where(and(eq(editorJobs.id, jobId.toLowerCase()), eq(editorJobs.status, "running")))
    .returning({ id: editorJobs.id });
  return { status: 200, body: { applied: rows.length > 0 } };
}
