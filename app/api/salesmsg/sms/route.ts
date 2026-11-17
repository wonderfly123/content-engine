/**
 * POST /api/salesmsg/sms?token=<SALESMSG_WEBHOOK_SECRET> — Salesmsg calls this for webhook events.
 *
 * No session here: the request proves itself with the shared secret in the URL
 * (`withSalesmsgToken`, used instead of `guard`), checked before anything touches the database.
 * Without the secret every request is refused with 403. Only inbound texts to the Content Engine
 * inbox are handled; the sender is identified only by a confirmed phone number (Settings), and the
 * reply goes back out through Salesmsg's API.
 * Public in the middleware: see PUBLIC_PREFIXES in lib/auth/access.ts.
 */
import type { NextRequest } from "next/server";
import { handleIncomingText } from "@/lib/conversations/handle";
import { maskPhone } from "@/lib/conversations/phone";
import { parseIncomingText, salesmsgConfig, sendSms, withSalesmsgToken } from "@/lib/conversations/texting";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The payload's structure with every value replaced by its type, except short ids/status words. Never the text or a number. */
function payloadShape(v: unknown, depth = 0): unknown {
  if (depth > 3) return "…";
  if (Array.isArray(v)) return v.length ? [payloadShape(v[0], depth + 1)] : [];
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>).map(([k, x]) => {
        const keep = /^(id|.*_id|status|type|event|direction)$/.test(k) && (typeof x === "number" || (typeof x === "string" && x.length < 40 && !/\d{7}/.test(x)));
        return [k, keep ? x : payloadShape(x, depth + 1)];
      }),
    );
  }
  return v === null ? null : typeof v;
}

export const POST = withSalesmsgToken(async (req: NextRequest, payload: unknown) => {
  const config = salesmsgConfig();
  if (!config) return Response.json({ ok: true, ignored: true });
  const text = parseIncomingText(payload, config);
  if (!text) {
    console.info("salesmsg webhook ignored:", JSON.stringify(payloadShape(payload)));
    return Response.json({ ok: true, ignored: true });
  }
  try {
    const reply = await handleIncomingText({
      from: text.from,
      body: text.body,
      messageSid: text.messageId,
      origin: req.nextUrl.origin,
    });
    if (reply) await sendSms(text.from, reply);
    return Response.json({ ok: true });
  } catch (error) {
    // Never log the message body or the full number.
    console.error(`Incoming text from ${maskPhone(text.from)} failed:`, (error as Error).message);
    return Response.json({ ok: false }, { status: 500 });
  }
});
