import type { SkillPath } from "@/lib/editor/skill-files";

/** Plain-language names for the editor's skill files, grouped the way someone thinks about an edit. */
export interface StepMeta {
  title: string;
  blurb: string;
}

export const STEP_META: Record<SkillPath, StepMeta> = {
  "SKILL.md": { title: "Main workflow", blurb: "The steps every edit follows: scan the clips, pick moments, cut, render and check." },
  "intake.md": { title: "Reading the request", blurb: "How the editor turns what you asked for into decisions without asking back." },
  "hooks.md": { title: "Hooks", blurb: "Rules for the opening words on screen." },
  "hooks-formulas.md": { title: "Hook formulas", blurb: "Proven hook patterns the editor can draw from." },
  "captions.md": { title: "Post captions", blurb: "How the caption under the post is written." },
  "profiles/build.md": { title: "Build videos", blurb: "What to show and how to pace a project or build video." },
  "profiles/event.md": { title: "Event videos", blurb: "What to show and how to pace an event recap." },
};

export const STEP_GROUPS: Array<{ label: string; paths: SkillPath[] }> = [
  { label: "How it edits", paths: ["SKILL.md", "intake.md"] },
  { label: "Words", paths: ["hooks.md", "hooks-formulas.md", "captions.md"] },
  { label: "Video types", paths: ["profiles/build.md", "profiles/event.md"] },
];
