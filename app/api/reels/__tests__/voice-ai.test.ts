import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE } from "../route";
import { POST } from "../voice-ai/route";
import type { ReelCut, ReelManifest } from "@/lib/reels/store";

vi.hoisted(() => {
  process.env.DATABASE_URL ??= "postgres://test:test@localhost/test";
});
vi.mock("@/lib/auth/session", () => ({ getAccess: async () => null }));
vi.mock("@/lib/auth/workspace", async () => ({
  ...(await vi.importActual<typeof import("@/lib/auth/workspace")>("@/lib/auth/workspace")),
  requireLocalReels: async () => ({ userId: "u", email: "", role: "admin", status: "active" }),
}));
const generateVoiceover = vi.hoisted(() => vi.fn(async (_text: string) => Buffer.from("RIFFwav")));
vi.mock("@/lib/reels/ai-voice", () => ({ generateVoiceover }));

let dir: string;
const previous = process.env.VIDEO_JOBS_DIR;
const manifestFile = () => path.join(dir, "demo", "_cuts", "review.json");

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
const speak = (text: string) => POST(json("/api/reels/voice-ai", "POST", { job: "demo", id: "a", text }));

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "reels-voice-ai-"));
  process.env.VIDEO_JOBS_DIR = dir;
  generateVoiceover.mockClear();
});
afterEach(() => {
  if (previous === undefined) delete process.env.VIDEO_JOBS_DIR;
  else process.env.VIDEO_JOBS_DIR = previous;
});

describe("POST /api/reels/voice-ai", () => {
  it("returns the spoken script as WAV audio without touching the manifest", async () => {
    await seed({});
    const before = await fs.readFile(manifestFile(), "utf8");
    const res = await speak(" There's a cider stand in my kitchen. ");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("audio/wav");
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe("RIFFwav");
    expect(generateVoiceover).toHaveBeenCalledWith("There's a cider stand in my kitchen.");
    expect(await fs.readFile(manifestFile(), "utf8")).toBe(before);
  });

  it("refuses empty text, unfilled brackets and cuts that are not in review", async () => {
    await seed({});
    expect((await speak("")).status).toBe(400);
    expect((await speak("It took [how long].")).status).toBe(400);
    await seed({ stage: "final_review" });
    expect((await speak("Hello.")).status).toBe(400);
    expect(generateVoiceover).not.toHaveBeenCalled();
  });

  it("reports a failed generation as an error", async () => {
    await seed({});
    generateVoiceover.mockRejectedValueOnce(new Error("The AI voice failed: boom"));
    const res = await speak("Hello.");
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "The AI voice failed: boom" });
  });
});

describe("DELETE /api/reels", () => {
  it("moves a cut in review to the deleted list and refuses later stages", async () => {
    await seed({});
    expect((await DELETE(json("/api/reels", "DELETE", { job: "demo", id: "a" }))).status).toBe(200);
    const m = JSON.parse(await fs.readFile(manifestFile(), "utf8")) as ReelManifest;
    expect(m.cuts).toEqual([]);
    expect(m.deleted?.[0]).toMatchObject({ id: "a", title: "A" });
    await seed({ stage: "scheduled" });
    expect((await DELETE(json("/api/reels", "DELETE", { job: "demo", id: "a" }))).status).toBe(400);
  });
});
