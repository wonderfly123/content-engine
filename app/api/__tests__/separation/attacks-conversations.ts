import type { RouteAttack } from "./attacks";
import type { Seeded } from "./world";

/** Own thread, their clip: the media id must belong to the thread named in the URL. */
const MIXED = "mixed request: the caller's own thread with the other workspace's clip, so neither side owns all of it";
// Storage (R2) is not configured in tests: past the checks the owner gets 503, which is not a refusal.
const STORAGE_OFF = "owner reaches storage";

const clip = (v: Seeded, mediaId = v.uploadingMediaId) => ({ id: v.conversationId, mediaId });
const UPLOADS = "app/api/conversations/[id]/uploads";

/** Conversations with the editor: threads reach their workspace directly (requireConversation). */
export const routes: RouteAttack[] = [
  { route: "app/api/conversations/route.ts", method: "GET", build: (v) => ({ query: { brandId: v.brandId } }) },
  { route: "app/api/conversations/route.ts", method: "POST", build: (v) => ({ body: { brandId: v.brandId, kind: "reel" } }) },
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
    route: "app/api/twilio/sms/route.ts",
    method: "POST",
    name: "unsigned text from their number",
    // No session can open this route: without a valid Twilio signature it is refused for everyone.
    build: (v) => ({ form: { From: v.phone, To: "+15550009999", Body: "new reel", MessageSid: "SMplanted" } }),
    skipOwnerControl: "Twilio signs every request; a signed-in user is not a way in (signed requests are tested in lib/conversations/__tests__/webhook.test.ts)",
  },
  {
    route: "app/api/media/optimized/route.ts",
    method: "POST",
    name: "unsigned optimizer callback swapping their clip",
    // No session can open this route: without the worker's HMAC signature it is refused for everyone.
    build: (v) => ({ body: { jobId: "00000000-0000-4000-8000-0000000000aa", mediaId: v.mediaId, ok: true, sizeBytes: 1, codec: "hevc" } }),
    skipOwnerControl: "the optimizer worker signs every callback; a signed-in user is not a way in (signed callbacks are tested in lib/media/__tests__/optimize.test.ts)",
  },
];
