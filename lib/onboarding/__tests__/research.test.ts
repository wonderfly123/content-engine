import { describe, expect, it, vi } from "vitest";
import {
  draftProfile,
  keepSourcedFacts,
  parseResearchOutput,
  RESEARCH_MODEL,
  researchBrand,
  sourcesRead,
  type MessagesCaller,
  type ResearchInput,
  type ResearchMessage,
} from "../research";

const input: ResearchInput = {
  brandName: "Sunset Taqueria",
  websiteUrl: "https://sunsettaqueria.example",
  instagramHandle: "sunsettaco",
  summary: "Tacos al pastor from a truck in Ocean Beach.",
  captions: [],
  captionsFrom: "none",
};

const goodJson = {
  whatTheyDo: "A taco truck serving al pastor in Ocean Beach.",
  whoItsFor: "Beachgoers and late-night locals.",
  voice: { tone: "Warm, short, a little cheeky.", wordsTheyUse: ["al pastor", "OB"], wordsToAvoid: ["authentic"] },
  facts: [
    { fact: "Parked on Newport Ave Friday and Saturday nights", source: "https://www.sunsettaqueria.example/locations/" },
    { fact: "Taco Tuesday: $2 tacos", source: "https://sunsettaqueria.example/menu" },
    { fact: "Won Best Tacos 2025 from a local paper", source: "https://news.example/best-tacos" },
    { fact: "Opened a second truck in La Jolla", source: "https://never-read.example/page" },
  ],
  exampleCaptions: ["Friday night, Newport Ave, al pastor. You know where to find us."],
};

/** A final reply that read three pages (two fetches and a search) and answers with `json`. */
function reply(json: unknown, stop = "end_turn"): ResearchMessage {
  return {
    stop_reason: stop,
    content: [
      { type: "thinking", thinking: "", signature: "sig" },
      { type: "server_tool_use", id: "srv_1", name: "web_fetch", input: { url: "https://sunsettaqueria.example" } },
      { type: "web_fetch_tool_result", tool_use_id: "srv_1", content: { type: "web_fetch_result", url: "https://sunsettaqueria.example/locations", content: {} } },
      { type: "web_fetch_tool_result", tool_use_id: "srv_2", content: { type: "web_fetch_result", url: "https://sunsettaqueria.example/menu", content: {} } },
      { type: "web_search_tool_result", tool_use_id: "srv_3", content: [{ type: "web_search_result", url: "https://news.example/best-tacos", title: "Best tacos" }] },
      { type: "text", text: `Here is the profile.\n\`\`\`json\n${JSON.stringify(json)}\n\`\`\`` },
    ],
  };
}

describe("parseResearchOutput", () => {
  it("validates a fenced JSON reply", () => {
    const out = parseResearchOutput("```json\n" + JSON.stringify(goodJson) + "\n```");
    expect(out.whatTheyDo).toMatch(/taco truck/);
    expect(out.voice.wordsToAvoid).toEqual(["authentic"]);
  });

  it("accepts bare JSON and fills missing lists with defaults", () => {
    const out = parseResearchOutput(`Sure: {"whatTheyDo": "Tacos."}`);
    expect(out).toEqual({ whatTheyDo: "Tacos.", whoItsFor: "", voice: { tone: "", wordsTheyUse: [], wordsToAvoid: [] }, facts: [], exampleCaptions: [] });
  });

  it("drops malformed list items and facts without a source instead of failing", () => {
    const out = parseResearchOutput(JSON.stringify({ whatTheyDo: "Tacos.", facts: [{ fact: "No source" }, { fact: "Ok", source: "https://a.example" }, 7], exampleCaptions: ["", "One"] }));
    expect(out.facts).toEqual([{ fact: "Ok", source: "https://a.example" }]);
    expect(out.exampleCaptions).toEqual(["One"]);
  });

  it("rejects a reply with no JSON, or without what the brand does", () => {
    expect(() => parseResearchOutput("I could not find anything.")).toThrow(/no JSON/);
    expect(() => parseResearchOutput(`{"whoItsFor": "people"}`)).toThrow(/did not match/);
  });
});

describe("brand facts must come from a page that was read", () => {
  it("collects the pages the server tools returned", () => {
    expect(sourcesRead(reply(goodJson).content)).toEqual([
      "https://sunsettaqueria.example/locations",
      "https://sunsettaqueria.example/menu",
      "https://news.example/best-tacos",
    ]);
  });

  it("keeps facts whose source was read (however the URL is written) and drops the rest", () => {
    const kept = keepSourcedFacts(goodJson.facts, sourcesRead(reply(goodJson).content), []);
    expect(kept.map((f) => f.fact)).toEqual([
      "Parked on Newport Ave Friday and Saturday nights",
      "Taco Tuesday: $2 tacos",
      "Won Best Tacos 2025 from a local paper",
    ]);
  });

  it("allows facts from the captions only when captions were given", () => {
    const facts = [{ fact: "Ships nationwide", source: "captions" }];
    expect(keepSourcedFacts(facts, [], [])).toEqual([]);
    expect(keepSourcedFacts(facts, [], ["captions"])).toEqual(facts);
  });
});

describe("researchBrand", () => {
  it("asks Claude Opus 5.5 with web fetch and web search, adaptive thinking, and instagram.com blocked", async () => {
    const call = vi.fn<MessagesCaller>(async () => reply(goodJson));
    const draft = await researchBrand(input, call);
    const body = call.mock.calls[0]![0] as Record<string, any>;
    expect(body.model).toBe(RESEARCH_MODEL);
    expect(RESEARCH_MODEL).toBe("claude-opus-5-5");
    expect(body.thinking).toEqual({ type: "adaptive" });
    expect(body.tools.map((t: { type: string }) => t.type)).toEqual(["web_fetch_20260209", "web_search_20260209"]);
    for (const tool of body.tools) expect(tool.blocked_domains).toContain("instagram.com");
    expect(body.messages[0].content).toContain("https://sunsettaqueria.example");
    expect(draft.fallback).toBe(false);
    expect(draft.profile.facts).toHaveLength(3);
    expect(draft.sources).toHaveLength(3);
  });

  it("resumes a paused turn by sending the turn so far back unchanged", async () => {
    const paused: ResearchMessage = { stop_reason: "pause_turn", content: [{ type: "server_tool_use", id: "srv_1", name: "web_fetch", input: { url: "https://sunsettaqueria.example" } }] };
    const call = vi.fn<MessagesCaller>().mockResolvedValueOnce(paused).mockResolvedValueOnce(reply(goodJson));
    await researchBrand(input, call);
    expect(call).toHaveBeenCalledTimes(2);
    const second = call.mock.calls[1]![0] as { messages: Array<{ role: string; content: unknown }> };
    expect(second.messages).toHaveLength(2);
    expect(second.messages[1]).toEqual({ role: "assistant", content: paused.content });
  });

  it("treats a refusal as a failed research", async () => {
    const call = vi.fn<MessagesCaller>(async () => ({ stop_reason: "refusal", content: [] }));
    await expect(researchBrand(input, call)).rejects.toThrow(/declined/);
  });
});

describe("draftProfile falls back to what they typed", () => {
  it("drafts with Claude without browsing when the research fails, and says so", async () => {
    const fallbackJson = { ...goodJson, facts: [{ fact: "Tacos al pastor", source: "your description" }, { fact: "Invented", source: "https://x.example" }] };
    const call = vi
      .fn<MessagesCaller>()
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(fallbackJson) }] });
    const draft = await draftProfile(input, call);
    expect(draft.fallback).toBe(true);
    expect(draft.note).toMatch(/only from what you typed/);
    expect(draft.error).toBe("network down");
    expect(draft.profile.facts).toEqual([{ fact: "Tacos al pastor", source: "your description" }]);
    expect((call.mock.calls[1]![0] as Record<string, unknown>).tools).toBeUndefined();
  });

  it("uses exactly what they typed when Claude cannot be reached at all", async () => {
    const call = vi.fn<MessagesCaller>(async () => {
      throw new Error("invalid x-api-key");
    });
    const draft = await draftProfile({ ...input, captions: ["Come hungry."], captionsFrom: "pasted" }, call);
    expect(draft.fallback).toBe(true);
    expect(draft.profile).toEqual({
      whatTheyDo: input.summary,
      whoItsFor: "",
      voice: { tone: "", wordsTheyUse: [], wordsToAvoid: [] },
      facts: [],
      exampleCaptions: ["Come hungry."],
    });
  });

  it("falls back without calling anything when there is no key", async () => {
    const draft = await draftProfile(input, null);
    expect(draft.fallback).toBe(true);
    expect(draft.error).toMatch(/No Anthropic key/);
  });

  it("falls back when the reply is not a valid profile", async () => {
    const call = vi.fn<MessagesCaller>(async () => ({ stop_reason: "end_turn", content: [{ type: "text", text: "Sorry, no JSON today." }] }));
    const draft = await draftProfile(input, call);
    expect(draft.fallback).toBe(true);
    expect(draft.profile.whatTheyDo).toBe(input.summary);
  });
});
