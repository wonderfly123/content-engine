import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveInJob } from "../store";

describe("resolveInJob", () => {
  const before = process.env.VIDEO_JOBS_DIR;
  beforeEach(() => { process.env.VIDEO_JOBS_DIR = path.join(path.sep, "library", "jobs"); });
  afterEach(() => { if (before === undefined) delete process.env.VIDEO_JOBS_DIR; else process.env.VIDEO_JOBS_DIR = before; });

  const at = (...parts: string[]) => path.join(path.sep, "library", ...parts);

  it("finds the job's own footage", () => {
    expect(resolveInJob("timonium", "footage/a.mov")).toBe(at("jobs", "timonium", "footage", "a.mov"));
  });

  it("finds footage borrowed from another job", () => {
    expect(resolveInJob("timonium", "../turf/footage/a.mov")).toBe(at("jobs", "turf", "footage", "a.mov"));
  });

  it("finds footage in a shared folder beside the jobs", () => {
    expect(resolveInJob("timonium", "../../generic-build/lumber-cart-to-truck.mov")).toBe(at("generic-build", "lumber-cart-to-truck.mov"));
  });

  it("refuses anything outside the video library", () => {
    expect(() => resolveInJob("timonium", "../../../etc/passwd.mov")).toThrow("escapes");
    expect(() => resolveInJob("timonium", "/etc/passwd.mov")).toThrow("escapes");
    expect(() => resolveInJob("timonium", "../../../library-other/a.mov")).toThrow("escapes");
  });

  it("refuses trashed footage", () => {
    expect(() => resolveInJob("timonium", "../.trash/old/a.mov")).toThrow("trash");
  });
});
