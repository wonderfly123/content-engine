import { describe, expect, it } from "vitest";
import { scriptPrompt, srtToText, writeVoiceScript } from "../voice-script-writer";

const cut = { title: "Setup 60s", seconds: 60, script: "ANGLE: the dry run\n\nSCRIPT\n\nIt took [how long]." };
const sources = { story: "Build of the cider stand.", transcripts: ["So this is the stand I built."] };
const reply = (text: string, status = 200) =>
  (async () => new Response(JSON.stringify({ content: [{ type: "text", text }] }), { status })) as unknown as typeof fetch;

describe("voice script writer", () => {
  it("turns subtitles into plain speech", () => {
    expect(srtToText("1\n00:00:00,250 --> 00:00:00,740\nSo this is\n\n2\n00:00:00,740 --> 00:00:01,470\nthe stand")).toBe("So this is the stand");
  });

  it("gives Claude the story, the earlier voice-overs, the draft and a word budget", () => {
    const prompt = scriptPrompt(cut, sources);
    for (const piece of ["Build of the cider stand.", "So this is the stand I built.", "It took [how long].", "54 to 90 spoken words"]) expect(prompt).toContain(piece);
  });

  it("adds the hook rules, formulas and anti-AI patterns when the skills are installed", () => {
    const prompt = scriptPrompt(cut, { ...sources, hookRules: "Four ways a hook fails", hookFormulas: "Formula 048", humanRules: "Staging instead of stating" });
    for (const piece of ["Four ways a hook fails", "Formula 048", "Staging instead of stating"]) expect(prompt).toContain(piece);
    expect(scriptPrompt(cut, sources)).not.toContain("Hook formulas");
  });

  it("returns clean lines with any leftover brackets removed", async () => {
    expect(await writeVoiceScript(cut, sources, "k", reply("There's a cider stand in my kitchen.\n\n\n\nIt took [how long] a while.\n"))).toBe(
      "There's a cider stand in my kitchen.\n\nIt took a while.",
    );
  });

  it("sends stills from the cut, labelled with their time, ahead of the prompt", async () => {
    let sent: { messages: Array<{ content: Array<{ type: string; text?: string; source?: { data: string } }> }> } | undefined;
    const spy = (async (_url: string, init: RequestInit) => {
      sent = JSON.parse(init.body as string);
      return new Response(JSON.stringify({ content: [{ type: "text", text: "Line." }] }));
    }) as unknown as typeof fetch;
    await writeVoiceScript(cut, { ...sources, frames: [{ at: 2.5, jpeg: Buffer.from("jpg") }] }, "k", spy);
    const content = sent!.messages[0].content;
    expect(content.map((c) => c.type)).toEqual(["text", "image", "text"]);
    expect(content[0].text).toBe("At 2.5s:");
    expect(content[1].source?.data).toBe(Buffer.from("jpg").toString("base64"));
    expect(content[2].text).toContain("stills from this video");
    expect(scriptPrompt(cut, sources)).not.toContain("stills from this video");
  });

  it("fails plainly when Claude refuses or answers nothing", async () => {
    await expect(writeVoiceScript(cut, sources, "k", reply("", 529))).rejects.toThrow(/529/);
    await expect(writeVoiceScript(cut, sources, "k", reply("  "))).rejects.toThrow(/empty/);
  });
});
