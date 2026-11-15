import type { ActionAttack } from "./attacks";

const SETTINGS = "app/settings/actions.ts";
const ONBOARDING = "app/onboarding/[brandId]/actions.ts";
const PHONE = "app/settings/phone-actions.ts";

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

export const actions: ActionAttack[] = [
  // ---- app/settings/actions.ts ----
  { file: SETTINGS, action: "setEnabledChannels", args: (victim) => [{ brandId: victim.brandId, channels: ["instagram"] }] },

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
  { file: ONBOARDING, action: "saveCadence", args: (victim) => [victim.brandId, { preset: "sustainable", rows: [] }] },
  { file: ONBOARDING, action: "markActive", args: (victim) => [victim.brandId] },

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

  // ---- app/settings/phone-actions.ts ----
  // These act on the caller's own number. Claiming the other workspace's number must fail and
  // leave their confirmed number untouched.
  {
    file: PHONE,
    action: "startPhoneVerification",
    args: (victim) => [{ phone: victim.phone, consent: true }],
    skipOwnerControl: "sending a code needs Twilio, which is switched off in tests (see lib/conversations/__tests__/phones.test.ts)",
  },
  {
    file: PHONE,
    action: "confirmPhone",
    args: () => [{ code: "123456" }],
    skipOwnerControl: "no code is pending for anyone in the test world (codes are tested in phones.test.ts)",
  },
  { file: PHONE, action: "removePhone", args: () => [], attackerMayPass: "removes the caller's own number only" },
];
