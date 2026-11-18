/**
 * A new route cannot forget the ownership check: every handler under app/api must be wrapped in
 * `guard(...)` and its file must call one of the access functions. Cron routes authenticate with
 * the cron secret instead and must use `withCronAuth`.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../../..");
// `requireConversation` (lib/conversations/access.ts) is built on requireUser + listMemberships:
// threads reach their workspace directly rather than through a brand. `requireMedia`
// (lib/media/access.ts) is built the same way for media objects on R2.
const CHECKS = /\b(requireUser|requireWorkspace|requireBrand|requireBrandBySlug|requireOwned|requireLocalReels|listBrandIds|requireAdmin|requireConversation|requireMedia)\s*\(/;

/**
 * Routes that can never carry a session, so they prove the caller another way. Each one is held to
 * exactly that way below; add to this list only with the same care.
 *  - Salesmsg's webhook: Salesmsg calls it with a shared secret in ?token=. The handler is wrapped in
 *    `withSalesmsgToken` (lib/conversations/texting.ts), which refuses with 403, before any database
 *    work, unless the token matches SALESMSG_WEBHOOK_SECRET (and refuses everything when it is not set).
 *  - Upload links (app/api/u/[token]/uploads/...): the signed token in the path is the key. Each
 *    handler is wrapped in `withUploadLink` (lib/conversations/upload-link.ts), which refuses with
 *    403, before any other work, unless the token verifies, then opens only the thread it names.
 *  - The optimizer worker's callback (workers/optimize on Modal): the worker signs the raw body
 *    with an HMAC-SHA256 of MODAL_OPTIMIZE_SECRET. The handler is wrapped in `withWorkerSignature`
 *    (lib/media/worker-signature.ts), which refuses with 403, before any database work, unless the
 *    X-Nekter-Signature matches (and refuses everything when the secret is not set).
 *  - The editor worker (workers/editor on Modal), both with MODAL_EDITOR_SECRET
 *    (lib/editor/worker-auth.ts), each refusing with 403 before any database work and refusing
 *    everything while the secret is not set:
 *      - its upload-link requests carry it as a bearer token (`withEditorBearer`);
 *      - its result callback signs the raw body with it, HMAC-SHA256 (`withEditorSignature`).
 */
const SIGNED_BY_PROVIDER: Record<string, { wrapper: string; module: string; verifier: string }> = {
  "app/api/salesmsg/sms/route.ts": { wrapper: "withSalesmsgToken", module: "lib/conversations/texting.ts", verifier: "isValidWebhookToken" },
  "app/api/w/[token]/route.ts": { wrapper: "withWatchLink", module: "lib/conversations/upload-link.ts", verifier: "verifyWatchToken" },
  "app/api/u/[token]/uploads/route.ts": { wrapper: "withUploadLink", module: "lib/conversations/upload-link.ts", verifier: "verifyUploadToken" },
  "app/api/u/[token]/uploads/[mediaId]/parts/route.ts": { wrapper: "withUploadLink", module: "lib/conversations/upload-link.ts", verifier: "verifyUploadToken" },
  "app/api/u/[token]/uploads/[mediaId]/complete/route.ts": { wrapper: "withUploadLink", module: "lib/conversations/upload-link.ts", verifier: "verifyUploadToken" },
  "app/api/u/[token]/uploads/[mediaId]/abort/route.ts": { wrapper: "withUploadLink", module: "lib/conversations/upload-link.ts", verifier: "verifyUploadToken" },
  "app/api/u/[token]/uploads/done/route.ts": { wrapper: "withUploadLink", module: "lib/conversations/upload-link.ts", verifier: "verifyUploadToken" },
  "app/api/media/optimized/route.ts": { wrapper: "withWorkerSignature", module: "lib/media/worker-signature.ts", verifier: "isValidWorkerSignature" },
  "app/api/media/frames/route.ts": { wrapper: "withWorkerSignature", module: "lib/media/worker-signature.ts", verifier: "isValidWorkerSignature" },
  "app/api/editor/uploads/route.ts": { wrapper: "withEditorBearer", module: "lib/editor/worker-auth.ts", verifier: "isValidEditorBearer" },
  "app/api/editor/callback/route.ts": { wrapper: "withEditorSignature", module: "lib/editor/worker-auth.ts", verifier: "isValidWorkerSignature" },
};

function routes(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name !== "__tests__") out.push(...routes(rel));
    } else if (entry.name === "route.ts") out.push(rel);
  }
  return out;
}

const all = routes("app/api");
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");

describe("every API route goes through the access layer", () => {
  it("finds the routes", () => {
    expect(all.length).toBeGreaterThan(40);
  });

  it.each(all.filter((f) => !f.startsWith("app/api/cron/") && !(f in SIGNED_BY_PROVIDER)))("%s", (file) => {
    const source = read(file);
    const bare = [...source.matchAll(/export\s+(?:async\s+)?function\s+(GET|POST|PATCH|PUT|DELETE)\b/g)].map((m) => m[1]);
    expect(bare, "handlers must be `export const METHOD = guard(...)`").toEqual([]);
    const handlers = [...source.matchAll(/export\s+const\s+(GET|POST|PATCH|PUT|DELETE)\s*=\s*(\w+)/g)];
    expect(handlers.length).toBeGreaterThan(0);
    for (const [, method, wrapper] of handlers) expect(wrapper, `${method} must be wrapped in guard(...)`).toBe("guard");
    expect(source).toMatch(/from\s+["']@\/lib\/auth\/workspace["']/);
    expect(CHECKS.test(source), "the file must call an access check").toBe(true);
  });

  it.each(Object.entries(SIGNED_BY_PROVIDER))("%s checks the provider's signature instead of a session", (file, { wrapper, module, verifier }) => {
    const source = read(file);
    expect(source).not.toMatch(/export\s+(?:async\s+)?function\s+(GET|POST|PATCH|PUT|DELETE)\b/);
    const handlers = [...source.matchAll(/export\s+const\s+(GET|POST|PATCH|PUT|DELETE)\s*=\s*(\w+)/g)];
    expect(handlers.length).toBeGreaterThan(0);
    for (const [, method, used] of handlers) expect(used, `${method} must be wrapped in ${wrapper}(...)`).toBe(wrapper);
    expect(source).toMatch(new RegExp(`from\\s+["']@/${module.replace(/\.ts$/, "")}["']`));
    // The wrapper itself verifies the signature and answers 403 otherwise.
    const lib = read(module);
    const body = lib.slice(lib.indexOf(`export function ${wrapper}(`));
    expect(body.length).toBeLessThan(lib.length);
    expect(body).toMatch(new RegExp(`${verifier}\\s*\\(`));
    expect(body).toMatch(/status:\s*403/);
  });

  it.each(all.filter((f) => f.startsWith("app/api/cron/")))("%s uses the cron secret", (file) => {
    const source = read(file);
    const handlers = [...source.matchAll(/export\s+const\s+(GET|POST)\s*=\s*(\w+)/g)];
    expect(handlers.length).toBeGreaterThan(0);
    for (const [, , wrapper] of handlers) expect(wrapper).toBe("withCronAuth");
    expect(source).not.toMatch(/export\s+(?:async\s+)?function\s+(GET|POST|PATCH|PUT|DELETE)\b/);
  });
});
