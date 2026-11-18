import { describe, expect, it } from "vitest";
import {
  carrierKeyword,
  decide,
  footageLine,
  listBrands,
  matchBrand,
  nextQuestion,
  replyFor,
  type BrandRef,
  type ReplyContext,
  type ThreadState,
} from "../router";

const wind: BrandRef = { id: "b-wind", name: "Windansea Coconuts", slug: "windansea-coconuts" };
const personal: BrandRef = { id: "b-personal", name: "Personal", slug: "personal" };
const gym: BrandRef = { id: "b-gym", name: "Iron Works Gym", slug: "iron-works" };
const several = [wind, personal, gym];
const fresh: ThreadState = { kind: null, brandId: null };
const set: ThreadState = { kind: "reel", brandId: wind.id };

const sms = (body: string, thread: ThreadState = set, brands: BrandRef[] = several) => decide({ body, channel: "sms", thread, brands });
const app = (body: string, thread: ThreadState = set, brands: BrandRef[] = several) => decide({ body, channel: "app", thread, brands });

describe("new reel / new story", () => {
  it("starts a new thread, whatever the case and punctuation", () => {
    expect(sms("new reel")).toEqual({ type: "new_thread", kind: "reel", brandId: null });
    expect(sms("New Reel!")).toEqual({ type: "new_thread", kind: "reel", brandId: null });
    expect(sms("  NEW   story.  ")).toEqual({ type: "new_thread", kind: "story", brandId: null });
    expect(app("new reels")).toEqual({ type: "new_thread", kind: "reel", brandId: null });
  });

  it("takes a brand named after it, forgivingly", () => {
    expect(sms("new reel windandsea")).toEqual({ type: "new_thread", kind: "reel", brandId: wind.id });
    expect(sms("New story for Personal")).toEqual({ type: "new_thread", kind: "story", brandId: personal.id });
    expect(sms("new reel iron-works")).toEqual({ type: "new_thread", kind: "reel", brandId: gym.id });
    expect(sms("new reel Iron Works Gym")).toEqual({ type: "new_thread", kind: "reel", brandId: gym.id });
  });

  it("uses the only brand when there is one, and leaves it open when nothing matches", () => {
    expect(sms("new reel", fresh, [wind])).toEqual({ type: "new_thread", kind: "reel", brandId: wind.id });
    expect(sms("new reel zzzz")).toEqual({ type: "new_thread", kind: "reel", brandId: null });
  });

  it("is not triggered by the words in the middle of a sentence", () => {
    expect(sms("can you make a new reel version")).toEqual({ type: "message" });
  });
});

describe("questions and answers", () => {
  it("answers Reel or story?", () => {
    expect(sms("reel", fresh)).toEqual({ type: "answer", kind: "reel" });
    expect(sms("A story please", fresh)).toEqual({ type: "answer", kind: "story" });
  });

  it("answers Which brand?, by name or slug, forgivingly", () => {
    const needsBrand = { kind: "reel", brandId: null } as const;
    expect(sms("windansea", needsBrand)).toEqual({ type: "answer", brandId: wind.id });
    expect(sms("Windandsea!", needsBrand)).toEqual({ type: "answer", brandId: wind.id });
    expect(sms("iron works", needsBrand)).toEqual({ type: "answer", brandId: gym.id });
    expect(sms("pers", needsBrand)).toEqual({ type: "answer", brandId: personal.id });
    expect(sms("for the personal brand", needsBrand)).toEqual({ type: "answer", brandId: personal.id });
  });

  it("takes both answers at once", () => {
    expect(sms("story for windansea", fresh)).toEqual({ type: "answer", kind: "story", brandId: wind.id });
  });

  it("does not treat a brand as an answer when the thread already has one, or with a single brand", () => {
    expect(sms("windansea")).toEqual({ type: "message" });
    expect(sms("windansea", { kind: "reel", brandId: null }, [wind])).toEqual({ type: "message" });
  });

  it("remembers a brand named exactly inside an ordinary message", () => {
    expect(sms("make the windansea-coconuts one punchier", { kind: "reel", brandId: null })).toEqual({ type: "message", brandId: wind.id });
  });

  it("treats a mixed message as ordinary", () => {
    expect(sms("reel with the sunset shot first", fresh)).toEqual({ type: "message" });
    expect(sms("reel or story, not sure", fresh)).toEqual({ type: "message" });
  });
});

describe("yes", () => {
  it.each(["yes", "YES!", "Yep", "yeah", "looks good", "ok", "👍", "Approve"])("%s is an approval", (body) => {
    expect(sms(body)).toEqual({ type: "approve" });
  });

  it("is not an approval inside a longer message", () => {
    expect(sms("yes but make the intro shorter")).toEqual({ type: "message" });
  });
});

describe("carrier keywords", () => {
  it("recognises STOP, START and HELP in texts and stays silent", () => {
    expect(sms("STOP")).toEqual({ type: "keyword", keyword: "stop" });
    expect(sms("unsubscribe")).toEqual({ type: "keyword", keyword: "stop" });
    expect(sms("Start")).toEqual({ type: "keyword", keyword: "start" });
    expect(sms("help")).toEqual({ type: "keyword", keyword: "help" });
    expect(replyFor({ type: "keyword", keyword: "stop" }, ctx())).toBeNull();
    expect(carrierKeyword("stop.")).toBe("stop");
    expect(carrierKeyword("stop the music")).toBeNull();
  });

  it("are ordinary words in the app", () => {
    expect(app("help")).toEqual({ type: "message" });
  });
});

describe("ordinary messages", () => {
  it("go to the editor", () => {
    expect(sms("make it 15 seconds")).toEqual({ type: "message" });
    expect(app("swap the music")).toEqual({ type: "message" });
  });
});

describe("matchBrand", () => {
  it("returns null for nothing, too little, or a tie", () => {
    expect(matchBrand("", several)).toBeNull();
    expect(matchBrand("x", several)).toBeNull();
    expect(matchBrand("abc", [{ id: "1", name: "Abcd One", slug: "abcd-one" }, { id: "2", name: "Abcd Two", slug: "abcd-two" }])).toBeNull();
  });

  it("prefers an exact name over the start of another", () => {
    const shortOne = { id: "w", name: "Wind", slug: "wind" };
    expect(matchBrand("wind", [shortOne, wind])?.id).toBe("w");
  });
});

function ctx(over: Partial<ReplyContext> = {}): ReplyContext {
  return { channel: "sms", thread: set, brands: several, askedBrand: false, link: "https://app.test/conversations/t1", ...over };
}

describe("replies", () => {
  it("asks Reel or story? first, then the brand once", () => {
    expect(nextQuestion(ctx({ thread: fresh }))).toBe("Reel or story?");
    expect(nextQuestion(ctx({ thread: { kind: "reel", brandId: null } }))).toBe("Which brand: Windansea Coconuts, Personal or Iron Works Gym?");
    expect(nextQuestion(ctx({ thread: { kind: "reel", brandId: null }, askedBrand: true }))).toBeNull();
    expect(nextQuestion(ctx({ thread: { kind: "reel", brandId: null }, brands: [wind] }))).toBeNull();
  });

  it("links to the thread in texts that need footage, and says upload is coming in the app", () => {
    expect(replyFor({ type: "new_thread", kind: "reel", brandId: wind.id }, ctx())).toBe(
      "New reel for Windansea Coconuts started. Tap to add your clips: https://app.test/conversations/t1",
    );
    expect(replyFor({ type: "answer", brandId: wind.id }, ctx({ channel: "app" }))).toBe(
      "Got it: a reel for Windansea Coconuts. Add your clips with the paperclip below, or drop them in.",
    );
    expect(footageLine("sms", "L")).toContain("L");
  });

  it("says the editor is not connected, and still asks an open question", () => {
    expect(replyFor({ type: "message" }, ctx())).toBe("Got it. The editor isn't connected yet, so I can't make changes for now.");
    expect(replyFor({ type: "message" }, ctx({ thread: fresh }))).toContain("Reel or story?");
  });

  it("says there is nothing to approve", () => {
    expect(replyFor({ type: "approve" }, ctx())).toBe("There's nothing waiting for your approval yet.");
  });

  it("lists brands naturally", () => {
    expect(listBrands(["A"])).toBe("A");
    expect(listBrands(["A", "B"])).toBe("A or B");
    expect(listBrands(["A", "B", "C"])).toBe("A, B or C");
  });
});
