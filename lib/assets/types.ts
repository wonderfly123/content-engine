import { z } from "zod";
import { assetKindValues, draftAssetRoleValues } from "@/lib/db/enums";

export const assetKindSchema = z.enum(assetKindValues);
export const draftAssetRoleSchema = z.enum(draftAssetRoleValues);

// ---------------------------------------------------------------------------
// POST /api/assets/upload-url
// ---------------------------------------------------------------------------
export const uploadUrlRequestSchema = z.object({
  brandId: z.string().uuid(),
  kind: assetKindSchema,
  filename: z.string().min(1).max(256),
  contentType: z.string().min(1).max(128),
});
export type UploadUrlRequest = z.infer<typeof uploadUrlRequestSchema>;

export const uploadUrlResponseSchema = z.object({
  url: z.string().url(),
  blobUrl: z.string().url(),
  pathname: z.string(),
  token: z.string().optional(),
});
export type UploadUrlResponse = z.infer<typeof uploadUrlResponseSchema>;

// ---------------------------------------------------------------------------
// POST /api/assets
// ---------------------------------------------------------------------------
export const createAssetRequestSchema = z.object({
  brandId: z.string().uuid(),
  draftId: z.string().uuid().optional(),
  blobUrl: z.string().url(),
  kind: assetKindSchema,
  slotIndex: z.number().int().min(0).max(9).optional(),
  role: draftAssetRoleSchema.optional(),
  label: z.string().max(256).optional().default(""),
  tags: z.array(z.string().min(1).max(64)).max(32).optional().default([]),
  mimeType: z.string().optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
});
export type CreateAssetRequest = z.infer<typeof createAssetRequestSchema>;

// ---------------------------------------------------------------------------
// GET /api/assets (query)
// ---------------------------------------------------------------------------
export const listAssetsQuerySchema = z.object({
  brandId: z.string().uuid(),
  kind: assetKindSchema.optional(),
  tag: z.string().optional(),
  search: z.string().optional(),
  archived: z
    .union([z.literal("true"), z.literal("false"), z.literal("all")])
    .optional()
    .default("false"),
  pending: z
    .union([z.literal("true"), z.literal("false")])
    .optional()
    .default("false"),
});
export type ListAssetsQuery = z.infer<typeof listAssetsQuerySchema>;

// ---------------------------------------------------------------------------
// PATCH /api/assets/[id]
// ---------------------------------------------------------------------------
export const updateAssetRequestSchema = z.object({
  label: z.string().max(256).optional(),
  tags: z.array(z.string().min(1).max(64)).max(32).optional(),
  archived: z.boolean().optional(),
  notes: z.string().optional(),
});
export type UpdateAssetRequest = z.infer<typeof updateAssetRequestSchema>;

// ---------------------------------------------------------------------------
// Validation result types
// ---------------------------------------------------------------------------
export interface ValidationError {
  code: string;
  expected: string;
  actual: string;
  message: string;
}

export interface ValidationOk {
  ok: true;
  metadata: AssetMetadata;
}

export interface ValidationFail {
  ok: false;
  error: ValidationError;
  metadata?: Partial<AssetMetadata>;
}

export type ValidationResult = ValidationOk | ValidationFail;

export interface AssetMetadata {
  width?: number;
  height?: number;
  durationSec?: number;
  sizeBytes: number;
  mimeType: string;
  hasAudio?: boolean;
  ratio?: number;
}
