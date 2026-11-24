import { createUploadToken } from "@/lib/conversations/upload-link";
import type { RouteAttack } from "./attacks";
import type { Seeded } from "./world";

/** Own thread, their clip: the media id must belong to the thread named in the URL. */
const MIXED = "mixed request: the caller's own thread with the other workspace's clip, so neither side owns all of it";
// Storage (R2) is not configured in tests: past the checks the owner gets 503, which is not a refusal.
const STORAGE_OFF = "owner reaches storage";

const clip = (v: Seeded, mediaId = v.uploadingMediaId) => ({ id: v.conversationId, mediaId });
const UPLOADS = "app/api/conversations/[id]/uploads";

/**
 * A token naming the victim's thread with a forged signature: the shape of a real upload link, but
 * not signed with the server's key. The link is the only key to these routes, so a session does nothing.
 */
const forged = (v: Seeded) => {
  const raw = Buffer.alloc(32);
  Buffer.from(v.conversationId.replace(/-/g, ""), "hex").copy(raw, 0);
  raw.writeUInt32BE(Math.floor(Date.now() / 1000) + 3600, 16);
  return raw.toString("base64url");
};
const LINK = "app/api/u/[token]/uploads";
const LINK_KEY = "the upload link is the only key (no session works); valid links are tested in lib/conversations/__tests__/upload-link.test.ts";

/** Conversations with the editor: threads reach their workspace directly (requireConversation). */
export const routes: RouteAttack[] = [
  { route: "app/api/w/[token]/route.ts", method: "POST", name: "forged watch link", build: (v) => ({ params: { token: forged(v) }, body: { action: "approve" } }), skipOwnerControl: LINK_KEY },
  {
    route: "app/api/w/[token]/route.ts",
    method: "POST",
    name: "their upload link used as a watch link",
    build: (v) => ({ params: { token: createUploadToken(v.conversationId) }, body: { action: "approve" } }),
    skipOwnerControl: LINK_KEY,
  },
  { route: `${LINK}/route.ts`, method: "POST", name: "forged link", build: (v) => ({ params: { token: forged(v) }, body: { filename: "clip.mov", size: 1000, contentType: "video/quicktime" } }), skipOwnerControl: LINK_KEY },
  { route: `${LINK}/[mediaId]/parts/route.ts`, method: "POST", name: "forged link", build: (v) => ({ params: { token: forged(v), mediaId: v.uploadingMediaId }, body: { partNumbers: [1] } }), skipOwnerControl: LINK_KEY },
  {
    route: `${LINK}/[mediaId]/parts/route.ts`,
    method: "POST",
    name: "own link, their clip",
    build: (v, a) => ({ params: { token: createUploadToken(a.conversationId), mediaId: v.uploadingMediaId }, body: { partNumbers: [1] } }),
    skipOwnerControl: MIXED,
  },
  { route: `${LINK}/[mediaId]/complete/route.ts`, method: "POST", name: "forged link", build: (v) => ({ params: { token: forged(v), mediaId: v.uploadingMediaId }, body: { parts: [{ partNumber: 1, etag: '"e"' }] } }), skipOwnerControl: LINK_KEY },
  { route: `${LINK}/[mediaId]/abort/route.ts`, method: "POST", name: "forged link", build: (v) => ({ params: { token: forged(v), mediaId: v.uploadingMediaId } }), skipOwnerControl: LINK_KEY },
  { route: `${LINK}/done/route.ts`, method: "POST", name: "forged link", build: (v) => ({ params: { token: forged(v) }, body: { mediaIds: [v.mediaId] } }), skipOwnerControl: LINK_KEY },
  { route: "app/api/conversations/[id]/schedule/route.ts", method: "GET", build: (v) => ({ params: { id: v.conversationId } }) },
  { route: "app/api/conversations/[id]/schedule/route.ts", method: "POST", build: (v) => ({ params: { id: v.conversationId }, body: { when: "tonight" } }) },
  { route: "app/api/conversations/[id]/schedule/route.ts", method: "DELETE", build: (v) => ({ params: { id: v.conversationId } }) },
  { route: "app/api/conversations/route.ts", method: "GET", build: (v) => ({ query: { brandId: v.brandId } }) },
  { route: "app/api/conversations/route.ts", method: "POST", build: (v) => ({ body: { brandId: v.brandId, kind: "reel" } }) },
  { route: "app/api/conversations/route.ts", method: "POST", name: "a campaign for their brand", build: (v) => ({ body: { brandId: v.brandId, kind: "campaign" } }) },
  { route: "app/api/conversations/[id]/route.ts", method: "GET", build: (v) => ({ params: { id: v.conversationId } }) },
  {
    route: "app/api/conversations/[id]/messages/route.ts",
    method: "POST",
    build: (v) => ({ params: { id: v.conversationId }, body: { body: "make it shorter" } }),
  },
  {
    route: "app/api/conversations/[id]/messages/route.ts",
    method: "POST",
    name: "new reel typed into their thread",
    build: (v) => ({ params: { id: v.conversationId }, body: { body: "new reel" } }),
  },

  // ---- clip uploads (R2). Every one is also tried as "own thread, their clip".
  {
    route: `${UPLOADS}/route.ts`,
    method: "POST",
    name: STORAGE_OFF,
    build: (v) => ({ params: { id: v.conversationId }, body: { filename: "clip.mov", size: 1000, contentType: "video/quicktime" } }),
  },
  { route: `${UPLOADS}/[mediaId]/parts/route.ts`, method: "POST", name: STORAGE_OFF, build: (v) => ({ params: clip(v), body: { partNumbers: [1] } }) },
  {
    route: `${UPLOADS}/[mediaId]/parts/route.ts`,
    method: "POST",
    name: "own thread, their clip",
    build: (v, a) => ({ params: { id: a.conversationId, mediaId: v.uploadingMediaId }, body: { partNumbers: [1] } }),
    skipOwnerControl: MIXED,
  },
  {
    route: `${UPLOADS}/[mediaId]/complete/route.ts`,
    method: "POST",
    name: STORAGE_OFF,
    build: (v) => ({ params: clip(v), body: { parts: [{ partNumber: 1, etag: '"etag-1"' }] } }),
  },
  {
    route: `${UPLOADS}/[mediaId]/complete/route.ts`,
    method: "POST",
    name: "own thread, their clip",
    build: (v, a) => ({ params: { id: a.conversationId, mediaId: v.uploadingMediaId }, body: { parts: [{ partNumber: 1, etag: '"etag-1"' }] } }),
    skipOwnerControl: MIXED,
  },
  { route: `${UPLOADS}/[mediaId]/abort/route.ts`, method: "POST", name: STORAGE_OFF, build: (v) => ({ params: clip(v) }) },
  {
    route: `${UPLOADS}/[mediaId]/abort/route.ts`,
    method: "POST",
    name: "own thread, their clip",
    build: (v, a) => ({ params: { id: a.conversationId, mediaId: v.uploadingMediaId } }),
    skipOwnerControl: MIXED,
  },
  { route: `${UPLOADS}/done/route.ts`, method: "POST", build: (v) => ({ params: { id: v.conversationId }, body: { mediaIds: [v.mediaId] } }) },
  {
    route: `${UPLOADS}/done/route.ts`,
    method: "POST",
    name: "own thread, their clip",
    build: (v, a) => ({ params: { id: a.conversationId }, body: { mediaIds: [v.mediaId] } }),
    skipOwnerControl: MIXED,
  },
  {
    route: `${UPLOADS}/done/route.ts`,
    method: "POST",
    name: "own thread, own and their clips",
    build: (v, a) => ({ params: { id: a.conversationId }, body: { mediaIds: [a.mediaId, v.mediaId] } }),
    skipOwnerControl: MIXED,
  },
  { route: "app/api/media/[mediaId]/route.ts", method: "GET", name: STORAGE_OFF, build: (v) => ({ params: { mediaId: v.mediaId } }) },
  {
    route: "app/api/media/[mediaId]/route.ts",
    method: "GET",
    name: "a clip still uploading",
    build: (v) => ({ params: { mediaId: v.uploadingMediaId } }),
  },

  // ---- the editor: approving cuts, watching previews, and the worker's own routes
  { route: "app/api/conversations/[id]/approve/route.ts", method: "POST", build: (v) => ({ params: { id: v.conversationId } }) },
  {
    route: "app/api/conversations/[id]/approve/route.ts",
    method: "POST",
    name: "their thread, naming their job",
    build: (v) => ({ params: { id: v.conversationId }, body: { jobId: v.editorJobId! } }),
  },

  // ---- a cut finished on the phone: its file takes the place of the editor's preview
  {
    route: "app/api/conversations/[id]/final/route.ts",
    method: "POST",
    name: STORAGE_OFF,
    build: (v) => ({ params: { id: v.conversationId }, body: { jobId: v.editorJobId!, cutKey: "cut-1", size: 1000 } }),
  },
  {
    route: "app/api/conversations/[id]/final/route.ts",
    method: "PATCH",
    name: STORAGE_OFF,
    build: (v) => ({
      params: { id: v.conversationId },
      body: { jobId: v.editorJobId!, cutKey: "cut-1", size: 1000, seconds: 12, shots: [{ mediaId: v.mediaId, in: 0, dur: 2, speed: 1, cropX: null }] },
    }),
  },

  // ---- campaigns: the plan pinned in a campaign chat (a reel chat answers null / 409 to its owner)
  { route: "app/api/conversations/[id]/campaign/route.ts", method: "GET", build: (v) => ({ params: { id: v.conversationId } }) },
  { route: "app/api/conversations/[id]/campaign/route.ts", method: "POST", name: "make their next video", build: (v) => ({ params: { id: v.conversationId }, body: { action: "next" } }) },
  {
    route: "app/api/conversations/[id]/campaign/route.ts",
    method: "POST",
    name: "approve their calendar",
    build: (v) => ({ params: { id: v.conversationId }, body: { action: "approve_plan" } }),
  },
  { route: "app/api/media/[mediaId]/route.ts", method: "GET", name: `their preview, ${STORAGE_OFF}`, build: (v) => ({ params: { mediaId: v.previewMediaId! } }) },
  {
    route: "app/api/editor/uploads/route.ts",
    method: "POST",
    name: "upload links for their job, without the worker's secret",
    build: (v) => ({ query: { job: v.editorJobId! }, body: { files: [{ name: "reel-15.mp4", contentType: "video/mp4" }] } }),
    skipOwnerControl: "only the editor worker (bearer MODAL_EDITOR_SECRET) may ask; a signed-in user is not a way in (tested in lib/editor/__tests__/editor.test.ts)",
  },
  {
    route: "app/api/editor/callback/route.ts",
    method: "POST",
    name: "unsigned editor callback for their job",
    build: (v) => ({ body: { jobId: v.editorJobId!, ok: false, error: "planted", manifest: null, reply: "", question: null, usage: null } }),
    skipOwnerControl: "the editor worker signs every callback; a signed-in user is not a way in (tested in lib/editor/__tests__/callback.test.ts)",
  },

  {
    route: "app/api/salesmsg/sms/route.ts",
    method: "POST",
    name: "text from their number without the webhook token",
    // No session can open this route: without Salesmsg's webhook token it is refused for everyone.
    build: (v) => ({ body: { message: { id: "SMplanted", status: "received", body: "new reel", received_at: "2026-11-17 10:00:00" }, contact: { number: v.phone }, inbox: { id: 1 } } }),
    skipOwnerControl: "Salesmsg calls with a shared secret; a signed-in user is not a way in (token-carrying requests are tested in lib/conversations/__tests__/webhook.test.ts)",
  },
  {
    route: "app/api/media/optimized/route.ts",
    method: "POST",
    name: "unsigned optimizer callback swapping their clip",
    // No session can open this route: without the worker's HMAC signature it is refused for everyone.
    build: (v) => ({ body: { jobId: "00000000-0000-4000-8000-0000000000aa", mediaId: v.mediaId, ok: true, sizeBytes: 1, codec: "hevc" } }),
    skipOwnerControl: "the optimizer worker signs every callback; a signed-in user is not a way in (signed callbacks are tested in lib/media/__tests__/optimize.test.ts)",
  },
  {
    route: "app/api/media/frames/route.ts",
    method: "POST",
    name: "unsigned frames callback describing their clip",
    // No session can open this route: without the worker's HMAC signature it is refused for everyone.
    build: () => ({ body: { jobId: "00000000-0000-4000-8000-0000000000ab", assetId: "00000000-0000-4000-8000-0000000000ac", ok: true } }),
    skipOwnerControl: "the frames worker signs every callback; a signed-in user is not a way in (signed callbacks are tested in lib/media/__tests__/describe.test.ts)",
  },
  {
    route: "app/api/editor/progress/route.ts",
    method: "POST",
    name: "unsigned editor progress on their job",
    // No session can open this route: without the worker's HMAC signature it is refused for everyone.
    build: () => ({ body: { jobId: "00000000-0000-4000-8000-0000000000ad", steps: [{ label: "Planted", at: "2026-11-18T10:00:00.000Z" }] } }),
    skipOwnerControl: "the editor worker signs every update; a signed-in user is not a way in (signed updates are tested in lib/editor/__tests__/progress.test.ts)",
  },
];
