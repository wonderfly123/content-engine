/**
 * POST /api/twilio/sms — Twilio calls this for every text sent to the app's number.
 *
 * No session here: the request proves itself with Twilio's signature (`withTwilioSignature`, used
 * instead of `guard`), checked against TWILIO_AUTH_TOKEN before anything touches the database.
 * Without the token every request is refused with 403. The sender is identified only by a
 * confirmed phone number (Settings), and lands in their own workspace's thread.
 * Public in the middleware: see PUBLIC_PREFIXES in lib/auth/access.ts.
 */
import type { NextRequest } from "next/server";
import { handleIncomingText } from "@/lib/conversations/handle";
import { maskPhone } from "@/lib/conversations/phone";
import { twimlResponse, withTwilioSignature } from "@/lib/conversations/twilio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withTwilioSignature(async (req: NextRequest, params: Record<string, string>) => {
  try {
    const reply = await handleIncomingText({
      from: params.From ?? "",
      body: params.Body ?? "",
      messageSid: params.MessageSid?.trim() || null,
      origin: req.nextUrl.origin,
    });
    return twimlResponse(reply);
  } catch (error) {
    // Never log the message body or the full number.
    console.error(`Incoming text from ${maskPhone(params.From ?? "")} failed:`, (error as Error).message);
    return twimlResponse("Something went wrong on our side. Please try again in a minute.");
  }
});
