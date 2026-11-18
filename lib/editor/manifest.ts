/**
 * The job contract with the editor worker (workers/editor on Modal), checked with zod. Everything
 * the worker sends is untrusted until it passes these shapes and the checks in ./callback.ts.
 */
import { z } from "zod";

const text = (max: number) => z.string().max(max);

export const edlEntrySchema = z.object({
  mediaId: z.string().uuid(),
  in: z.number().nonnegative(),
  dur: z.number().positive(),
  // Same limits as the worker (workers/editor/contract.py): a fast pan can be sped up a lot.
  speed: z.number().positive().max(100),
  cropX: z.number().nullable(),
});

export const cutSchema = z.object({
  id: text(100).min(1),
  title: text(3000),
  seconds: z.number().nonnegative().max(60 * 60),
  mode: z.enum(["music", "voice"]),
  preview: z.object({ key: text(1024).min(1) }),
  edl: z.array(edlEntrySchema).max(500),
  hookOptions: z.array(text(500)).max(20),
  caption: text(5000),
  script: text(20000).nullable(),
  coverAt: z.number().nonnegative(),
});

export const manifestSchema = z.object({ cuts: z.array(cutSchema).min(1).max(10) });

export const usageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative().max(100_000),
  turns: z.number().int().nonnegative(),
  seconds: z.number().nonnegative(),
});

export const callbackSchema = z.object({
  jobId: z.string().uuid(),
  ok: z.boolean(),
  error: text(4000).nullable().optional(),
  manifest: manifestSchema.nullable().optional(),
  reply: text(4000).default(""),
  question: text(2000).nullable().optional(),
  usage: usageSchema.nullable().optional(),
});

export const MAX_UPLOAD_FILES = 10;
export const UPLOAD_TYPES = ["video/mp4", "image/jpeg"] as const;

export const uploadsRequestSchema = z.object({
  files: z
    .array(z.object({ name: text(255).min(1), contentType: z.enum(UPLOAD_TYPES) }))
    .min(1)
    .max(MAX_UPLOAD_FILES),
});

export type EditorCallback = z.infer<typeof callbackSchema>;
export type EditorUsage = z.infer<typeof usageSchema>;
export type WorkerCut = z.infer<typeof cutSchema>;
export type WorkerManifest = z.infer<typeof manifestSchema>;

/** A cut as stored: the worker's cut, with the preview's media row id added. */
export type EditorCut = Omit<WorkerCut, "preview"> & { preview: { key: string; mediaId: string } };
export interface EditorManifest {
  cuts: EditorCut[];
}
