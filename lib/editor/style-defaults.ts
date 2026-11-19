/**
 * Default editor style: every section prefilled from today's skill markdown (the repo copy bundled
 * in ./skill-defaults.generated.ts), so the text boxes show what the editor already does. A brand
 * that never edits a section sends nothing for it (./style-compile.ts), so its jobs run exactly as
 * before. Safe to import from client code.
 */
import { SKILL_DEFAULTS } from "./skill-defaults.generated";
import type { EditorStyle, FootageType, SectionValue, StyleSectionId } from "./style-schema";

const md = (path: string): string => SKILL_DEFAULTS[path] ?? "";

/** The body under `## heading` (up to the next `## `), trimmed; "" when missing. */
export function mdSection(path: string, heading: string): string {
  const text = md(path);
  const start = text.indexOf(`\n## ${heading}`);
  if (start < 0) return "";
  const bodyStart = text.indexOf("\n", start + 1);
  const next = text.indexOf("\n## ", bodyStart);
  return text.slice(bodyStart, next < 0 ? undefined : next).trim();
}

/** Numbered item `n.` of a markdown list in `path` (to the next item or heading), trimmed. */
export function mdItem(path: string, n: number): string {
  const text = md(path);
  const start = text.search(new RegExp(`\\n${n}\\. \\*\\*`));
  if (start < 0) return "";
  const rest = text.slice(start + 1);
  const end = rest.slice(1).search(/\n(\d+\. \*\*|## )/);
  return (end < 0 ? rest : rest.slice(0, end + 1)).trim();
}

/** The bold titles of a numbered list ("1. **Change you can see**: ...") under `## heading`. */
function rankedTitles(path: string, heading: string): string[] {
  return [...mdSection(path, heading).matchAll(/^\d+\. \*\*([^*]+)\*\*/gm)].map((m) => m[1].trim());
}

function builtInTypes(): FootageType[] {
  return [
    {
      id: "build",
      name: "Build",
      builtIn: true,
      when: "Something being made or put together, with no one talking to the camera.",
      ranked: rankedTitles("profiles/build.md", "What makes a moment worth using (strongest first)"),
      pacing: "Short videos use quick shots, about 1 second each. Longer videos hold shots longer and speed up more of the slow work.",
      notes:
        "Open on the finished result. Then show the build in the order it happened, and end on the finished result from a different angle.\n" +
        "Put before and after shots of the same thing next to each other.\n" +
        "Mix wide shots and close-ups, and never use the same moment twice.\n" +
        "When a clip pans across something, use the whole pan sped up, not a slice of it.",
    },
    {
      id: "event",
      name: "Event",
      builtIn: true,
      when: "An event, activation or pop-up: setting up, the day itself and the people.",
      ranked: rankedTitles("profiles/event.md", "What makes a moment worth using (strongest first)"),
      pacing: "Start each shot just before the moment happens. Keep people at real speed; only speed up setup, pans and long crowd shots.",
      notes:
        "Open on the busiest, liveliest moment, never on loading in.\n" +
        "Then: a quick look at getting there, the finished setup, the event at its busiest, and a strong closing image.\n" +
        "Event day usually gets most of the screen time.",
    },
  ];
}

/** "Counts against a moment: a, b, and c." -> [a, b, c] from build.md. */
function skipList(): string[] {
  const line = /Counts against a moment: ([\s\S]*?)\.\n/.exec(md("profiles/build.md"))?.[1] ?? "";
  return line
    .replace(/\s+/g, " ")
    .split(/, (?:and )?/)
    .map((s) => s.replace(/^and /, "").trim())
    .filter(Boolean);
}

/** "## Not allowed" in hooks.md, split into its items. */
function neverList(): string[] {
  const body = mdSection("hooks.md", "Not allowed").replace(/\s+/g, " ").replace(/\.$/, "");
  return body.split(/, (?=["a-zA-Z])/).map((s) => s.trim()).filter(Boolean);
}

function build(): EditorStyle {
  const sections: Record<StyleSectionId, SectionValue> = {
    brand: {
      picks: { voice: "", facts: "", neverSay: [] },
      notes:
        "Only say things the request, the brand info or the footage actually shows.\n" +
        "Never make up places, names, clients, dates or prices. If a fact is missing, leave it out.",
    },
    opener: {
      picks: { firstShot: "auto", textStyles: [], maxWords: 9, examples: [] },
      notes:
        "In the first two seconds, people should know what the video is about and want to keep watching.\n" +
        "Get straight to the point: no greeting, no \"wait till you see this\".\n" +
        "Use short, plain words that are easy to read at a glance.\n" +
        "Make it about the viewer, and leave one question open that the video answers.",
    },
    shots: {
      picks: {
        ranked: ["Something visibly changing or happening", "The reveal or the finished result", "People in the moment and their reactions", "Hands, tools and product in action", "Details and textures, as breathers"],
        skip: skipList(),
        startAtMoment: true,
      },
      notes: "Don't start a shot at the beginning of a clip. Find the moment (the pour, the reaction, the reveal) and start just before it.",
    },
    pacing: {
      picks: {
        shot15: "about 1s (0.8 to 1.6s)",
        shot30: "1.5 to 2s",
        shot45: "2 to 3s",
        shot60: "2.5 to 3.5s",
        speedUp: ["Pans across the subject", "Setup and loading stretches", "Long assembly stretches", "Long locked-off crowd shots"],
        maxSpedUp: 3,
        realSpeedPeople: true,
      },
      notes: "Short videos move fast. Longer videos hold shots a little longer and speed up more of the slow parts.",
    },
    structure: {
      picks: { order: "auto", ending: "auto", screenTime: "auto" },
      notes: "Group the clips by what they show and when they were filmed, and give the best parts the most screen time.",
    },
    lengths: {
      picks: { reel: ["15", "30"], story: "15", campaign: "30" },
      notes: "A reel gets a 15-second and a 30-second version. A story gets one 15-second version. Other lengths only when you ask.",
    },
    sound: {
      picks: { mood: [], cutOnBeat: "auto", effects: false },
      notes: "Cuts follow the music. No voice-over.",
    },
    captions: {
      picks: { tone: "brand", length: "medium", emojis: 3, hashtags: 3, fixedHashtags: [], cta: "" },
      notes:
        "Turn the notes into natural, flowing sentences in the brand's voice. Simple, not cheesy.\n" +
        "A few emojis, then 3 hashtags on their own line at the end.\n" +
        "The longest video gets 2 to 3 sentences; shorter ones get a shorter version. Stories get no caption.",
    },
    footage: {
      picks: { types: builtInTypes() },
      notes: "Treat footage as a build unless the request or the footage says it's an event.",
    },
    never: {
      // The list carries hooks.md's "Not allowed" items; the box starts empty.
      picks: { rules: neverList() },
      notes: "",
    },
  };
  return sections;
}

let cached: EditorStyle | null = null;

/** Today's behaviour, section by section (a fresh copy each call). */
export function defaultStyle(): EditorStyle {
  cached ??= build();
  return structuredClone(cached);
}

export function defaultSection(id: StyleSectionId): SectionValue {
  return defaultStyle()[id];
}
