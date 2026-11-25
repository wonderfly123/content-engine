import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PATCH } from "../route";
import type { ReelCut, ReelManifest } from "@/lib/reels/store";

// The route is platform-admin only; these tests are about what it does once the caller is let in.
vi.hoisted(() => {
  process.env.DATABASE_URL ??= "postgres://test:test@localhost/test";
});
vi.mock("@/lib/auth/session", () => ({ getAccess: async () => null }));
vi.mock("@/lib/auth/workspace", async () => ({
  ...(await vi.importActual<typeof import("@/lib/auth/workspace")>("@/lib/auth/workspace")),
  requireLocalReels: async () => ({ userId: "u", email: "", role: "admin", status: "active" }),
}));

let dir: string;
const previous = process.env.VIDEO_JOBS_DIR;

async function seed(cut: Partial<ReelCut>): Promise<void> {
  const manifest: ReelManifest = {
    job: "demo",
    brand: "personal",
    cuts: [{ id: "a", title: "A", seconds: 30, mode: "music", stage: "cut_review", preview: "previews/a.mp4", ...cut }],
  };
  await fs.mkdir(path.join(dir, "demo", "_cuts", "edl"), { recursive: true });
  await fs.writeFile(path.join(dir, "demo", "_cuts", "edl", "a.tsv"), "footage/one.mov|2|3|1\n../../generic-build/two.mov|10|40|20\n");
  await fs.writeFile(path.join(dir, "demo", "_cuts", "review.json"), JSON.stringify(manifest));
}
const saved = async (): Promise<ReelCut> => (JSON.parse(await fs.readFile(path.join(dir, "demo", "_cuts", "review.json"), "utf8")) as ReelManifest).cuts[0];
const sendBack = (body: Record<string, unknown>) =>
  PATCH(new NextRequest("http://localhost/api/reels", { method: "PATCH", body: JSON.stringify({ job: "demo", id: "a", action: "request_changes", ...body }) }));

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "reels-changes-"));
  process.env.VIDEO_JOBS_DIR = dir;
});
afterEach(async () => {
  if (previous === undefined) delete process.env.VIDEO_JOBS_DIR; else process.env.VIDEO_JOBS_DIR = previous;
  await fs.rm(dir, { recursive: true, force: true });
});

describe("sending a cut back", () => {
  it("saves clip notes with each clip's footage and timecodes", async () => {
    await seed({ edl: "edl/a.tsv" });
    const res = await sendBack({ note: " slower music ", clipNotes: [{ clip: 2, from: 3.5, to: 4.5, text: "Remove this" }, { clip: 1, from: 0, to: 3, text: "Hold this longer" }] });
    expect(res.status).toBe(200);
    const cut = await saved();
    expect(cut).toMatchObject({ changesRequested: true, note: "slower music", stage: "cut_review" });
    expect(cut.clipNotes).toEqual([
      { clip: 1, file: "footage/one.mov", from: 2, to: 5, at: 0, until: 3, whole: true, text: "Hold this longer" },
      { clip: 2, file: "../../generic-build/two.mov", from: 20, to: 40, at: 3.5, until: 4.5, whole: false, text: "Remove this" },
    ]);
  });

  it("accepts clip notes without an overall note, and a finished cut goes back to the editor", async () => {
    await seed({ edl: "edl/a.tsv", stage: "final_review" });
    expect((await sendBack({ note: "", clipNotes: [{ clip: 1, from: 0, to: 3, text: "Swap this for a different shot" }] })).status).toBe(200);
    const cut = await saved();
    expect(cut).toMatchObject({ changesRequested: true, note: "", stage: "editing" });
    expect(cut.clipNotes).toHaveLength(1);
  });

  it("replaces earlier clip notes when sent back again with only an overall note", async () => {
    await seed({ edl: "edl/a.tsv" });
    await sendBack({ clipNotes: [{ clip: 1, from: 0, to: 3, text: "x" }] });
    await sendBack({ note: "different song" });
    const cut = await saved();
    expect(cut.note).toBe("different song");
    expect(cut.clipNotes).toBeUndefined();
  });

  it("refuses an empty send-back, a note on a clip that is not there, and clip notes on a cut without a clip list", async () => {
    await seed({ edl: "edl/a.tsv" });
    expect((await sendBack({ note: "  " })).status).toBe(400);
    expect((await sendBack({ clipNotes: [{ clip: 3, from: 0, to: 1, text: "x" }] })).status).toBe(400);
    expect((await saved()).changesRequested).toBeUndefined();
    await seed({});
    const res = await sendBack({ clipNotes: [{ clip: 1, from: 0, to: 1, text: "x" }] });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("no clip list");
  });
});
