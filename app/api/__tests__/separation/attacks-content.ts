import type { RouteAttack } from "./attacks";

const FUTURE = "2099-01-01T00:00:00.000Z";
const MIXED = "mixed request: the caller's own record with the other workspace's id, so neither side may get through";

export const routes: RouteAttack[] = [
  // ---- briefs
  { route: "app/api/briefs/route.ts", method: "GET", build: (v) => ({ query: { brandId: v.brandId } }) },
  { route: "app/api/briefs/route.ts", method: "GET", name: "no brand named", build: () => ({}), attackerMayPass: "lists the caller's own brands only" },
  { route: "app/api/briefs/route.ts", method: "POST", build: (v) => ({ body: { brandId: v.brandId, channel: "instagram", format: "reel", title: "planted brief", icpId: v.icpId } }) },
  {
    route: "app/api/briefs/route.ts",
    method: "POST",
    name: "own brand, their icp",
    build: (v, a) => ({ body: { brandId: a.brandId, channel: "instagram", format: "reel", title: "planted brief", icpId: v.icpId } }),
    skipOwnerControl: MIXED,
  },
  { route: "app/api/briefs/batch/route.ts", method: "POST", build: (v) => ({ body: { brandId: v.brandId } }) },
  { route: "app/api/briefs/[id]/route.ts", method: "GET", build: (v) => ({ params: { id: v.briefId } }) },
  { route: "app/api/briefs/[id]/route.ts", method: "PATCH", build: (v) => ({ params: { id: v.briefId }, body: { title: "taken over", icpId: v.icpId, markEdited: true } }) },
  {
    route: "app/api/briefs/[id]/route.ts",
    method: "PATCH",
    name: "own brief, their icp",
    build: (v, a) => ({ params: { id: a.briefId }, body: { icpId: v.icpId } }),
    skipOwnerControl: MIXED,
  },
  { route: "app/api/briefs/[id]/route.ts", method: "DELETE", build: (v) => ({ params: { id: v.briefId } }) },
  { route: "app/api/briefs/[id]/approve/route.ts", method: "POST", build: (v) => ({ params: { id: v.briefId } }) },
  { route: "app/api/briefs/[id]/reject/route.ts", method: "POST", build: (v) => ({ params: { id: v.briefId }, body: { reason: "not yours" } }) },

  // ---- drafts
  { route: "app/api/drafts/route.ts", method: "GET", build: (v) => ({ query: { brandId: v.brandId } }) },
  { route: "app/api/drafts/route.ts", method: "GET", name: "no brand named", build: () => ({}), attackerMayPass: "lists the caller's own brands only" },
  { route: "app/api/drafts/[id]/route.ts", method: "GET", build: (v) => ({ params: { id: v.draftId } }) },
  { route: "app/api/drafts/[id]/route.ts", method: "PATCH", build: (v) => ({ params: { id: v.draftId }, body: { caption: "taken over", markEdited: true } }) },
  { route: "app/api/drafts/[id]/approve/route.ts", method: "POST", build: (v) => ({ params: { id: v.draftId } }) },
  { route: "app/api/drafts/[id]/reject/route.ts", method: "POST", build: (v) => ({ params: { id: v.draftId }, body: { reason: "not yours" } }) },
  { route: "app/api/drafts/[id]/attach/route.ts", method: "POST", build: (v) => ({ params: { id: v.draftId }, body: { assetId: v.assetId, slotIndex: 0, role: "primary" } }) },
  {
    route: "app/api/drafts/[id]/attach/route.ts",
    method: "POST",
    name: "own draft, their asset",
    build: (v, a) => ({ params: { id: a.draftId }, body: { assetId: v.assetId, slotIndex: 1, role: "cover" } }),
    skipOwnerControl: MIXED,
  },
  {
    route: "app/api/drafts/[id]/attach/route.ts",
    method: "POST",
    name: "their draft, own asset",
    build: (v, a) => ({ params: { id: v.draftId }, body: { assetId: a.assetId, slotIndex: 1, role: "cover" } }),
    skipOwnerControl: MIXED,
  },

  // ---- posts
  { route: "app/api/posts/route.ts", method: "GET", build: (v) => ({ query: { brandId: v.brandId } }) },
  { route: "app/api/posts/[id]/route.ts", method: "GET", build: (v) => ({ params: { id: v.postId } }) },
  { route: "app/api/posts/[id]/route.ts", method: "PATCH", build: (v) => ({ params: { id: v.postId }, body: { scheduledFor: FUTURE } }) },
  { route: "app/api/posts/[id]/route.ts", method: "DELETE", build: (v) => ({ params: { id: v.postId } }) },
  // [id] here is a draft id.
  { route: "app/api/posts/[id]/schedule/route.ts", method: "POST", build: (v) => ({ params: { id: v.draftId }, body: { scheduledFor: FUTURE } }) },

  // ---- comments
  { route: "app/api/comments/[postId]/route.ts", method: "GET", build: (v) => ({ params: { postId: v.postId } }) },
];
