import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "../accept/route";
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
  await fs.mkdir(path.join(dir, "demo", "_cuts"), { recursive: true });
  await fs.writeFile(path.join(dir, "demo", "_cuts", "review.json"), JSON.stringify(manifest));
}

async function saved(): Promise<ReelCut> {
  const m = JSON.parse(await fs.readFile(path.join(dir, "demo", "_cuts", "review.json"), "utf8")) as ReelManifest;
  return m.cuts[0];
}

function accept(fields: Record<string, string>, audio?: Blob): Promise<Response> {
  const form = new FormData();
  for (const [k, v] of Object.entries({ job: "demo", id: "a", voice: "0", hook: "", ...fields })) form.set(k, v);
  if (audio) form.set("audio", audio, "voiceover");
  return POST(new NextRequest("http://localhost/api/reels/accept", { method: "POST", body: form }));
}

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "reels-accept-"));
  process.env.VIDEO_JOBS_DIR = dir;
});
afterEach(() => {
  if (previous === undefined) delete process.env.VIDEO_JOBS_DIR;
  else process.env.VIDEO_JOBS_DIR = previous;
});

describe("POST /api/reels/accept", () => {
  it("sends an untouched cut with a finished file straight to final review", async () => {
    await seed({ final: "previews/a.mp4" });
    expect((await accept({})).status).toBe(200);
    expect(await saved()).toMatchObject({ stage: "final_review", mode: "music", hook: "" });
  });

  it("hands edits and opening text to the editor", async () => {
    await seed({ final: "previews/a.mp4" });
    const res = await accept({ hook: " Watch this ", edits: JSON.stringify([{ from: 2, to: 10 }, { from: 14, to: 28 }]) });
    expect(res.status).toBe(200);
    expect(await saved()).toMatchObject({ stage: "editing", hook: "Watch this", edits: { keep: [{ from: 2, to: 10 }, { from: 14, to: 28 }], seconds: 22 } });
  });

  it("saves a voice-over and marks the cut voice-led", async () => {
    await seed({ stage: "voiceover", mode: "voice" });
    const res = await accept({ voice: "1" }, new Blob(["audio"], { type: "audio/webm;codecs=opus" }));
    expect(res.status).toBe(200);
    const cut = await saved();
    expect(cut).toMatchObject({ stage: "editing", mode: "voice", voiceover: "vo/a-take1.webm" });
    expect(await fs.readFile(path.join(dir, "demo", "_cuts", "vo", "a-take1.webm"), "utf8")).toBe("audio");
  });

  it("refuses a voice-over choice with no recording, bad edits, and cuts in the wrong stage", async () => {
    await seed({});
    expect((await accept({ voice: "1" })).status).toBe(400);
    expect((await accept({ edits: JSON.stringify([{ from: 5, to: 2 }]) })).status).toBe(400);
    expect((await saved()).stage).toBe("cut_review");
    await seed({ stage: "final_review" });
    expect((await accept({})).status).toBe(400);
  });
});
