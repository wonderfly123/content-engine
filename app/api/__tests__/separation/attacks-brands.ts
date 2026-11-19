/**
 * Cross-workspace attempts for: brands, assets, alerts, the Meta OAuth callback.
 */
import type { RouteAttack } from "./attacks";
import type { Seeded } from "./world";

const brandQuery = (victim: Seeded) => ({ query: { brandId: victim.brandId } });
const brandParam = (victim: Seeded) => ({ params: { id: victim.brandId } });
const assetParam = (victim: Seeded) => ({ params: { id: victim.assetId } });

const newAsset = (brandId: string) => ({
  brandId,
  blobUrl: "https://files.test/new/upload.jpg",
  kind: "image",
  label: "new upload",
  mimeType: "image/jpeg",
});

const uploadToken = (brandId: string) => ({
  type: "blob.generate-client-token",
  payload: {
    pathname: "upload.mp4",
    callbackUrl: "http://localhost/api/assets/upload-url",
    multipart: false,
    clientPayload: JSON.stringify({ brandId, kind: "video", filename: "upload.mp4", contentType: "video/mp4" }),
  },
});

const MIXED = "mixed request: it names the attacker's brand and the victim's record, so neither side owns all of it";

export const routes: RouteAttack[] = [
  // ---- brands ------------------------------------------------------------
  {
    route: "app/api/brands/route.ts",
    method: "GET",
    build: () => ({}),
    attackerMayPass: "names no brand: lists the caller's own brands only",
  },
  {
    route: "app/api/brands/route.ts",
    method: "POST",
    build: () => ({ body: { description: "A new brand made in the caller's own workspace" } }),
    attackerMayPass: "names no brand: creates a brand in the caller's own workspace",
  },
  { route: "app/api/brands/[id]/route.ts", method: "GET", build: brandParam },
  {
    route: "app/api/brands/[id]/route.ts",
    method: "PATCH",
    name: "rename and archive",
    build: (victim) => ({ ...brandParam(victim), body: { name: "Taken over", description: "taken over", status: "archived" } }),
  },
  { route: "app/api/brands/[id]/research/route.ts", method: "GET", build: brandParam },

  // ---- storage (Settings > Storage) ----------------------------------------
  { route: "app/api/brands/[id]/storage/route.ts", method: "GET", build: brandParam },
  { route: "app/api/brands/[id]/storage/route.ts", method: "PUT", build: (victim) => ({ ...brandParam(victim), body: { retention: "after_post" } }) },

  // ---- editor style (Settings > Editor style) ------------------------------
  { route: "app/api/brands/[id]/editor-style/route.ts", method: "GET", build: brandParam },
  {
    route: "app/api/brands/[id]/editor-style/route.ts",
    method: "POST",
    name: "save a section",
    build: (victim) => ({ ...brandParam(victim), body: { action: "save", section: "opener", value: { picks: { maxWords: 4 }, notes: "taken over" } } }),
  },
  { route: "app/api/brands/[id]/editor-style/route.ts", method: "POST", name: "reset a section", build: (victim) => ({ ...brandParam(victim), body: { action: "reset", section: "never" } }) },
  { route: "app/api/brands/[id]/editor-style/history/route.ts", method: "GET", build: (victim) => ({ ...brandParam(victim), query: { section: "never" } }) },
  {
    route: "app/api/brands/[id]/editor-style/suggestions/route.ts",
    method: "POST",
    name: "accept their suggestion",
    build: (victim) => ({ ...brandParam(victim), body: { suggestionId: victim.styleSuggestionId, decision: "accept" } }),
  },
  {
    route: "app/api/brands/[id]/editor-style/suggestions/route.ts",
    method: "POST",
    name: "own brand, their suggestion",
    build: (victim, attacker) => ({ params: { id: attacker.brandId }, body: { suggestionId: victim.styleSuggestionId, decision: "dismiss" } }),
    skipOwnerControl: MIXED,
  },
  // For the victim this answers 409 (no "About" answers yet), so it never starts a run in tests.
  { route: "app/api/brands/[id]/research/route.ts", method: "POST", build: (victim) => ({ ...brandParam(victim), body: { restart: true } }) },

  // ---- assets ------------------------------------------------------------
  { route: "app/api/assets/route.ts", method: "GET", build: brandQuery },
  {
    route: "app/api/assets/route.ts",
    method: "GET",
    name: "with filters",
    build: (victim) => ({ query: { brandId: victim.brandId, archived: "all", kind: "video", pending: "false" } }),
  },
  { route: "app/api/assets/route.ts", method: "POST", build: (victim) => ({ body: newAsset(victim.brandId) }) },
  {
    route: "app/api/assets/route.ts",
    method: "POST",
    name: "attached to their draft",
    build: (victim) => ({ body: { ...newAsset(victim.brandId), draftId: victim.draftId, slotIndex: 1, role: "primary" } }),
  },
  {
    route: "app/api/assets/route.ts",
    method: "POST",
    name: "own brand, their draft",
    build: (victim, attacker) => ({ body: { ...newAsset(attacker.brandId), draftId: victim.draftId, slotIndex: 1, role: "primary" } }),
    skipOwnerControl: MIXED,
  },
  { route: "app/api/assets/[id]/route.ts", method: "GET", build: assetParam },
  {
    route: "app/api/assets/[id]/route.ts",
    method: "PATCH",
    build: (victim) => ({ ...assetParam(victim), body: { label: "taken over", tags: ["x"], archived: true, notes: "taken over" } }),
  },
  { route: "app/api/assets/[id]/route.ts", method: "DELETE", build: assetParam },
  { route: "app/api/assets/[id]/preview/route.ts", method: "GET", build: assetParam },
  {
    route: "app/api/assets/upload-url/route.ts",
    method: "POST",
    name: "upload token for their brand",
    build: (victim) => ({ body: uploadToken(victim.brandId) }),
  },

  // ---- alerts ------------------------------------------------------------
  { route: "app/api/alerts/route.ts", method: "GET", name: "their brand", build: brandQuery },
  {
    route: "app/api/alerts/route.ts",
    method: "GET",
    name: "no brand",
    build: () => ({}),
    attackerMayPass: "names no brand: lists alerts for the caller's own brands only",
  },
  {
    route: "app/api/alerts/route.ts",
    method: "GET",
    name: "scope=all with their brand",
    build: (victim) => ({ query: { scope: "all", brandId: victim.brandId } }),
    attackerMayPass: "scope=all ignores the brand id and lists alerts for the caller's own brands only",
  },

  // ---- Meta OAuth callback -----------------------------------------------
  {
    route: "app/api/oauth/meta/callback/route.ts",
    method: "GET",
    name: "state names their brand",
    build: (victim) => ({ query: { code: "meta-code", state: `${victim.brandId}|nonce` } }),
  },
  {
    route: "app/api/oauth/meta/callback/route.ts",
    method: "GET",
    name: "with page and ad account picks",
    build: (victim) => ({ query: { code: "meta-code", state: `${victim.brandId}|nonce`, page_id: "1", ad_account_id: "act_1" } }),
  },
];
