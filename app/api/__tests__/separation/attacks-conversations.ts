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

  {
    route: "app/api/twilio/sms/route.ts",
    method: "POST",
    name: "unsigned text from their number",
    // No session can open this route: without a valid Twilio signature it is refused for everyone.
    build: (v) => ({ form: { From: v.phone, To: "+15550009999", Body: "new reel", MessageSid: "SMplanted" } }),
    skipOwnerControl: "Twilio signs every request; a signed-in user is not a way in (signed requests are tested in lib/conversations/__tests__/webhook.test.ts)",
  },
];
