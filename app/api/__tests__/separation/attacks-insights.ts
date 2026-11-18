/**
 * Cross-workspace attempts on analytics, ads, admin and reel routes.
 */
import type { RouteAttack, RouteRequest } from "./attacks";
import type { Seeded } from "./world";

const ADMIN_ONLY = "platform admin only";
const LOCAL_REELS = "local reel jobs are platform-admin only until cloud jobs exist";

const byBrand = (victim: Seeded): RouteRequest => ({ query: { brandId: victim.brandId } });
/** A reel job as the local workflow names them; the cut is one a reviewer would act on. */
const cut = { job: "demo", id: "a" };

export const routes: RouteAttack[] = [
  // Analytics
  { route: "app/api/analytics/post/[id]/route.ts", method: "GET", build: (victim) => ({ params: { id: victim.postId } }) },
  { route: "app/api/analytics/posts/route.ts", method: "GET", build: byBrand },
  { route: "app/api/analytics/posts/route.ts", method: "GET", name: "all time", build: (victim) => ({ query: { brandId: victim.brandId, range: "all" } }) },
  { route: "app/api/analytics/topline/route.ts", method: "GET", build: byBrand },
  { route: "app/api/analytics/topline/route.ts", method: "GET", name: "all time", build: (victim) => ({ query: { brandId: victim.brandId, range: "all" } }) },
  { route: "app/api/analytics/trends/route.ts", method: "GET", build: byBrand },
  {
    route: "app/api/analytics/refresh/route.ts",
    method: "POST",
    build: (victim) => ({ body: { brandId: victim.brandId } }),
  },

  // Ads
  { route: "app/api/ads/campaigns/route.ts", method: "GET", build: byBrand },
  { route: "app/api/ads/summary/route.ts", method: "GET", build: (victim) => ({ query: { brandId: victim.brandId, days: "90" } }) },

  // Admin
  { route: "app/api/admin/connections/route.ts", method: "GET", build: () => ({}), skipOwnerControl: ADMIN_ONLY },
  { route: "app/api/admin/storage/route.ts", method: "GET", build: () => ({}), skipOwnerControl: ADMIN_ONLY },
  { route: "app/api/admin/storage/route.ts", method: "PUT", build: () => ({ body: { retention: "after_post" } }), skipOwnerControl: ADMIN_ONLY },
  { route: "app/api/admin/connections/route.ts", method: "POST", build: () => ({}), skipOwnerControl: ADMIN_ONLY },
  { route: "app/api/admin/users/route.ts", method: "GET", build: () => ({}), skipOwnerControl: ADMIN_ONLY },
  {
    route: "app/api/admin/users/route.ts",
    method: "PATCH",
    build: (victim) => ({ body: { id: victim.user.userId, action: "disable" } }),
    skipOwnerControl: ADMIN_ONLY,
  },
  { route: "app/api/admin/workspaces/route.ts", method: "GET", build: () => ({}), skipOwnerControl: ADMIN_ONLY },
  {
    route: "app/api/admin/workspaces/route.ts",
    method: "PATCH",
    build: (victim) => ({ body: { id: victim.workspaceId, status: "disabled" } }),
    skipOwnerControl: ADMIN_ONLY,
  },

  { route: "app/api/admin/skill/route.ts", method: "GET", build: () => ({}), skipOwnerControl: ADMIN_ONLY },
  {
    route: "app/api/admin/skill/route.ts",
    method: "POST",
    build: () => ({ body: { action: "save", path: "hooks.md", content: "taken over" } }),
    skipOwnerControl: ADMIN_ONLY,
  },
  { route: "app/api/admin/skill/history/route.ts", method: "GET", build: () => ({ query: { path: "hooks.md" } }), skipOwnerControl: ADMIN_ONLY },

  // Reels (jobs on the machine's disk)
  { route: "app/api/reels/route.ts", method: "GET", build: (victim) => ({ query: { brand: victim.slug } }), skipOwnerControl: LOCAL_REELS },
  { route: "app/api/reels/route.ts", method: "GET", name: "every job", build: () => ({}), skipOwnerControl: LOCAL_REELS },
  {
    route: "app/api/reels/route.ts",
    method: "PATCH",
    build: () => ({ body: { ...cut, action: "save_caption", caption: "taken over" } }),
    skipOwnerControl: LOCAL_REELS,
  },
  {
    route: "app/api/reels/accept/route.ts",
    method: "POST",
    build: () => ({ form: { ...cut, voice: "0", hook: "taken over" } }),
    skipOwnerControl: LOCAL_REELS,
  },
  {
    route: "app/api/reels/accept/route.ts",
    method: "POST",
    name: "with a recording",
    build: () => ({ form: { ...cut, voice: "1", hook: "", audio: new Blob(["audio"], { type: "audio/webm" }) } }),
    skipOwnerControl: LOCAL_REELS,
  },
  { route: "app/api/reels/clips/route.ts", method: "GET", build: () => ({ query: cut }), skipOwnerControl: LOCAL_REELS },
  {
    route: "app/api/reels/clips/route.ts",
    method: "POST",
    build: () => ({ body: { ...cut, clips: [{ file: "IMG_0001.MOV", in: 0, dur: 2, speed: 1 }] } }),
    skipOwnerControl: LOCAL_REELS,
  },
  { route: "app/api/reels/clips/route.ts", method: "POST", name: "revert", build: () => ({ body: { ...cut, revert: true } }), skipOwnerControl: LOCAL_REELS },
  { route: "app/api/reels/media/route.ts", method: "GET", build: () => ({ query: { job: cut.job, file: "previews/a.mp4" } }), skipOwnerControl: LOCAL_REELS },
  {
    route: "app/api/reels/media/route.ts",
    method: "GET",
    name: "source footage",
    build: () => ({ query: { job: cut.job, file: "IMG_0001.MOV", footage: "1" } }),
    skipOwnerControl: LOCAL_REELS,
  },
  {
    route: "app/api/reels/schedule/route.ts",
    method: "POST",
    build: () => ({
      body: { ...cut, caption: "taken over", when: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), mode: "trial-manual", coverAt: 1, hook: "" },
    }),
    skipOwnerControl: LOCAL_REELS,
  },
  { route: "app/api/reels/thumb/route.ts", method: "GET", build: () => ({ query: { job: cut.job, file: "IMG_0001.MOV", t: "0" } }), skipOwnerControl: LOCAL_REELS },
];
