import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PATCH } from "../route";
import { POST } from "../voice-script/route";
import type { ReelCut, ReelManifest } from "@/lib/reels/store";

vi.hoisted(() => {
  process.env.DATABASE_URL ??= "postgres://test:test@localhost/test";
});
vi.mock("@/lib/auth/session", () => ({ getAccess: async () => null }));
vi.mock("@/lib/auth/workspace", async () => ({
  ...(await vi.importActual<typeof import("@/lib/auth/workspace")>("@/lib/auth/workspace")),
  requireLocalReels: async () => ({ userId: "u", email: "", role: "admin", status: "active" }),
  requireBrandBySlug: async () => ({ brandId: "b" }),
}));
vi.mock("@/lib/credentials/store", () => ({ getCredentialForBrand: async () => "key" }));
vi.mock("@/lib/reels/render", () => ({ sampleFrames: async () => [] }));
const writeVoiceScript = vi.hoisted(() => vi.fn(async () => "A written line."));
vi.mock("@/lib/reels/voice-script-writer", () => ({ writeVoiceScript, readScriptSources: async () => ({ story: "", transcripts: [] }) }));

let dir: string;
const previous = process.env.VIDEO_JOBS_DIR;
const manifestFile = () => path.join(dir, "demo", "_cuts", "review.json");
const saved = async () => (JSON.parse(await fs.readFile(manifestFile(), "utf8")) as ReelManifest).cuts[0];

async function seed(cut: Partial<ReelCut>): Promise<void> {
  const manifest: ReelManifest = {
    job: "demo",
    brand: "personal",
    cuts: [{ id: "a", title: "A", seconds: 60, mode: "voice", stage: "cut_review", preview: "previews/a.mp4", ...cut }],
  };
  await fs.mkdir(path.dirname(manifestFile()), { recursive: true });
  await fs.writeFile(manifestFile(), JSON.stringify(manifest));
}
const json = (url: string, method: string, body: unknown) =>
  new NextRequest(`http://localhost${url}`, { method, body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
const ask = (force?: boolean) => POST(json("/api/reels/voice-script", "POST", { job: "demo", id: "a", force }));

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "reels-voice-script-"));
  process.env.VIDEO_JOBS_DIR = dir;
  writeVoiceScript.mockClear();
});
afterEach(() => {
  if (previous === undefined) delete process.env.VIDEO_JOBS_DIR;
  else process.env.VIDEO_JOBS_DIR = previous;
});

describe("POST /api/reels/voice-script", () => {
  it("writes a script once, saves it with the cut, and gives the saved one back afterwards", async () => {
    await seed({});
    const [first, second] = await Promise.all([ask(), ask()]);
    expect(await first.json()).toMatchObject({ script: "A written line." });
    expect(await second.json()).toMatchObject({ script: "A written line." });
    expect((await saved()).voiceScript).toBe("A written line.");
    expect((await (await ask()).json()).script).toBe("A written line.");
    expect(writeVoiceScript).toHaveBeenCalledTimes(1);
  });

  it("keeps the reviewer's edits until they ask for a new script", async () => {
    await seed({ voiceScript: "A written line." });
    const res = await PATCH(json("/api/reels", "PATCH", { job: "demo", id: "a", action: "save_voice_script", voiceScript: "My own words." }));
    expect(res.status).toBe(200);
    expect((await (await ask()).json()).script).toBe("My own words.");
    expect(writeVoiceScript).not.toHaveBeenCalled();
    expect((await (await ask(true)).json()).script).toBe("A written line.");
    expect((await saved()).voiceScript).toBe("A written line.");
  });

  it("does not save a script on a cut that has left review", async () => {
    await seed({ stage: "final_review" });
    const res = await PATCH(json("/api/reels", "PATCH", { job: "demo", id: "a", action: "save_voice_script", voiceScript: "Late." }));
    expect(res.status).toBe(400);
    expect((await saved()).voiceScript).toBeUndefined();
  });
});
