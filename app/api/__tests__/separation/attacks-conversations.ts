import type { RouteAttack } from "./attacks";

/** Conversations with the editor: threads reach their workspace directly (requireConversation). */
export const routes: RouteAttack[] = [
  { route: "app/api/conversations/route.ts", method: "GET", build: (v) => ({ query: { brandId: v.brandId } }) },
  { route: "app/api/conversations/route.ts", method: "POST", build: (v) => ({ body: { brandId: v.brandId, kind: "reel" } }) },
  { route: "app/api/conversations/[id]/route.ts", method: "GET", build: (v) => ({ params: { id: v.conversationId } }) },
  {
    route: "app/api/conversations/[id]/messages/route.ts",
    method: "POST",
    build: (v) => ({ params: { id: v.conversationId }, body: { body: "make it shorter" } }),
  },
  {
    route: "app/api/conversations/[id]/messages/route.ts",
    method: "POST",
    name: "new reel typed into their thread",
    build: (v) => ({ params: { id: v.conversationId }, body: { body: "new reel" } }),
  },
  {
    route: "app/api/twilio/sms/route.ts",
    method: "POST",
    name: "unsigned text from their number",
    // No session can open this route: without a valid Twilio signature it is refused for everyone.
    build: (v) => ({ form: { From: v.phone, To: "+15550009999", Body: "new reel", MessageSid: "SMplanted" } }),
    skipOwnerControl: "Twilio signs every request; a signed-in user is not a way in (signed requests are tested in lib/conversations/__tests__/webhook.test.ts)",
  },
];
