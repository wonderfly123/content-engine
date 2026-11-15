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
 *  - Twilio's webhook: Twilio signs every request. The handler is wrapped in `withTwilioSignature`
 *    (lib/conversations/twilio.ts), which refuses with 403, before any database work, unless the
 *    X-Twilio-Signature matches TWILIO_AUTH_TOKEN (and refuses everything when it is not set).
 */
const SIGNED_BY_PROVIDER: Record<string, { wrapper: string; module: string }> = {
  "app/api/twilio/sms/route.ts": { wrapper: "withTwilioSignature", module: "lib/conversations/twilio.ts" },
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

  it.each(Object.entries(SIGNED_BY_PROVIDER))("%s checks the provider's signature instead of a session", (file, { wrapper, module }) => {
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
    expect(body).toMatch(/isValidTwilioSignature\s*\(/);
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
