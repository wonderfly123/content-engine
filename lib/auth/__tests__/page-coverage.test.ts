/**
 * A page, server component or server action cannot forget the ownership check: every file under
 * `app/` (API routes have their own test, route-coverage) that reads the database must call one of
 * the access functions from `lib/auth/workspace`.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../../..");

/** `@/lib/db` or anything under it, except the type-only and enum modules. */
const READS_DB = /from\s+["']@\/lib\/db(?:\/(?!types["']|enums["'])[^"']*)?["']/;
const CHECKS = /\b(tryBrand|tryOwned|tryWorkspace|requireBrand|requireOwned|requireWorkspace|listBrandIds)\s*\(/;

/**
 * Step components that make no check of their own because they take no id from the request: they
 * are handed a whole brand row by a page that has already checked it. The last test below holds
 * every file that imports one of these to the check, so the exemption cannot be reached unchecked.
 * Do not add a file here if it reads an id from params, searchParams, cookies or a form.
 */
const RENDERED_BY_A_CHECKED_PAGE = [
  "app/onboarding/[brandId]/steps/4-icps.tsx", // props: { brand }
  "app/onboarding/[brandId]/steps/5-cadence.tsx", // props: { brand }
  "app/onboarding/[brandId]/steps/6-channels.tsx", // props: { brand }
  "app/onboarding/[brandId]/steps/7-done.tsx", // props: { brand }
];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (rel === "app/api" || entry.name === "__tests__" || entry.name === "node_modules") continue;
    if (entry.isDirectory()) out.push(...walk(rel));
    else if (/\.tsx?$/.test(entry.name)) out.push(rel);
  }
  return out;
}

const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");
const all = walk("app");
const readers = all.filter((f) => READS_DB.test(read(f)));

describe("every page and server action that reads the database goes through the access layer", () => {
  it("finds the files", () => {
    expect(readers.length).toBeGreaterThan(5);
    for (const file of RENDERED_BY_A_CHECKED_PAGE) expect(readers, `${file} no longer reads the database; drop it from the list`).toContain(file);
  });

  it("each one calls an access check", () => {
    const missing = readers.filter((f) => !RENDERED_BY_A_CHECKED_PAGE.includes(f) && !CHECKS.test(read(f)));
    expect(missing).toEqual([]);
  });

  it.each(RENDERED_BY_A_CHECKED_PAGE)("%s is only rendered by files that check", (file) => {
    const name = path.basename(file).replace(/\.tsx?$/, "");
    const importers = all.filter((f) => f !== file && new RegExp(`from\\s+["'][^"']*/${name}["']`).test(read(f)));
    expect(importers.length).toBeGreaterThan(0);
    expect(importers.filter((f) => !CHECKS.test(read(f)))).toEqual([]);
  });
});
