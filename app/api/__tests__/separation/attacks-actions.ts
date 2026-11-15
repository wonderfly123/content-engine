import type { ActionAttack } from "./attacks";

const SETTINGS = "app/settings/actions.ts";
const ONBOARDING = "app/onboarding/[brandId]/actions.ts";

/** A complete, valid profile (what the review step submits). */
const profile = {
  name: "Renamed brand",
  slug: "renamed-brand",
  tagline: "A new tagline",
  audienceSummary: "",
  archetype: "sage",
  traits: [],
  pointOfView: "",
  toneSliders: { formality: 50, playfulness: 50, authority: 50, boldness: 50, wit: 50, verbosity: 50 },
  emojiPolicy: "sparing",
  hashtagStyle: "few-strategic",
  readingLevel: "general",
  bannedWords: [],
  signaturePhrases: [],
  voiceFreeform: "",
  voiceExamples: [],
};

const MIXED = "the caller's own brand with someone else's keyword is never a valid call, for anyone";

export const actions: ActionAttack[] = [
  // ---- app/settings/actions.ts ----
  { file: SETTINGS, action: "setEnabledChannels", args: (victim) => [{ brandId: victim.brandId, channels: ["instagram"] }] },
  { file: SETTINGS, action: "addKeyword", args: (victim) => [{ brandId: victim.brandId, term: "planted keyword" }] },
  { file: SETTINGS, action: "setKeywordStatus", args: (victim) => [{ brandId: victim.brandId, keywordId: victim.keywordId, status: "paused" }] },
  {
    file: SETTINGS,
    action: "setKeywordStatus",
    name: "own brand, their keyword",
    args: (victim, attacker) => [{ brandId: attacker.brandId, keywordId: victim.keywordId, status: "paused" }],
    skipOwnerControl: MIXED,
  },
  { file: SETTINGS, action: "deleteKeyword", args: (victim) => [{ brandId: victim.brandId, keywordId: victim.keywordId }] },
  {
    file: SETTINGS,
    action: "deleteKeyword",
    name: "own brand, their keyword",
    args: (victim, attacker) => [{ brandId: attacker.brandId, keywordId: victim.keywordId }],
    skipOwnerControl: MIXED,
  },
  { file: SETTINGS, action: "pullKeywordNow", args: (victim) => [{ brandId: victim.brandId, keywordId: victim.keywordId }] },
  {
    file: SETTINGS,
    action: "pullKeywordNow",
    name: "own brand, their keyword",
    args: (victim, attacker) => [{ brandId: attacker.brandId, keywordId: victim.keywordId }],
    skipOwnerControl: MIXED,
  },

  // ---- app/onboarding/[brandId]/actions.ts ----
  // Names no brand: it creates one in the caller's own workspace and then redirects (which throws),
  // so there is nothing of the victim's to aim at. The test still proves it leaks and changes nothing.
  { file: ONBOARDING, action: "createBrand", args: () => [{ description: "A brand new brand" }] },
  {
    file: ONBOARDING,
    action: "startAnalysis",
    args: (victim) => [victim.brandId],
    skipOwnerControl: "the action catches the analysis failure itself (no network or API key in tests) and answers { ok: false } for the owner too",
  },
  { file: ONBOARDING, action: "saveProfile", args: (victim) => [victim.brandId, profile] },
  {
    file: ONBOARDING,
    action: "saveICPs",
    args: (victim) => [victim.brandId, { icps: [{ id: victim.icpId, name: "Renamed icp", isDefault: true }] }],
  },
  {
    file: ONBOARDING,
    action: "saveICPs",
    name: "own brand, their ICP id",
    // Must not touch the victim's ICP; for the attacker it is just a new ICP on their own brand.
    args: (victim, attacker) => [attacker.brandId, { icps: [{ id: victim.icpId, name: "Renamed icp", isDefault: true }] }],
    skipOwnerControl: "aims at the attacker's brand; the victim cannot reach it",
  },
  { file: ONBOARDING, action: "saveCompetitorsInspiration", args: (victim) => [victim.brandId, { competitors: [], inspiration: [] }] },
  { file: ONBOARDING, action: "saveCadence", args: (victim) => [victim.brandId, { preset: "sustainable", rows: [] }] },
  { file: ONBOARDING, action: "markActive", args: (victim) => [victim.brandId, { triggerResearch: true }] },

  // ---- app/settings/connection-actions.ts ----
  // These name no workspace: they act on the caller's own. The victim's keys must be untouched.
  {
    file: "app/settings/connection-actions.ts",
    action: "saveConnection",
    args: () => [{ provider: "anthropic", secret: "replacement-key-123456" }],
    attackerMayPass: "acts on the caller's own workspace",
    skipOwnerControl: "a key is tested against its service before saving, and the network is off in tests",
  },
  {
    file: "app/settings/connection-actions.ts",
    action: "removeConnection",
    args: () => [{ provider: "anthropic" }],
    attackerMayPass: "acts on the caller's own workspace",
  },
];
