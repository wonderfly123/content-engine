/**
 * Public facts about the business behind the app, used on the landing page and the policy
 * pages (which the texting provider and phone carriers review before approving texting).
 *
 * Fill in every field marked TODO before the texting registration is submitted.
 */
export const SITE = {
  productName: "Nekter",
  /** The name the business operates under (there is no separate legal entity name). */
  businessName: "nekter.io",
  /** The public website (landing and policies). */
  siteHost: "nekter.io",
  /** Where people sign in and use the app. */
  appHost: "app.nekter.io",
  /** TODO: where people can reach a person about their account or texts. */
  supportEmail: "support@nekter.io",
  /** Name of the texting program, as registered. */
  textingProgram: "Nekter Editor",
  /** Date the policy pages were last changed. */
  policiesUpdated: "November 14, 2026",
} as const;
