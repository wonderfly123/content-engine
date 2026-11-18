import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { maskPhone, normalizePhone } from "../phone";
import { appUrl, isValidWebhookToken, parseIncomingText, resetSalesmsgTokenCache, salesmsgConfig, salesmsgToken, sendSms, TextingNotConfiguredError } from "../texting";

const env = { SALESMSG_API_TOKEN: "tok", SALESMSG_TEAM_ID: "4242", SALESMSG_PHONE_NUMBER: "(801) 457-0307" };
const broker = { SALESMSG_TOKEN_URL: "https://wd.test/api/internal/salesmsg-token", SALESMSG_TOKEN_SHARE_SECRET: "share" };
const benv = { ...broker, SALESMSG_TEAM_ID: "4242" };
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

beforeEach(() => resetSalesmsgTokenCache());

/** A fake WD Capital broker plus Salesmsg: `valid` is the token Salesmsg accepts. */
function world(o: { tokens: string[]; valid: string; brokerDown?: boolean }) {
  const calls = { broker: [] as { rejected?: string }[], sends: [] as string[] };
  let i = 0;
  const fetchImpl = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("https://wd.test/")) {
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer share");
      if (o.brokerDown) return new Response("{}", { status: 502 });
      const body = JSON.parse(String(init?.body ?? "{}")) as { rejected?: string };
      calls.broker.push(body);
      if (body.rejected) i = Math.min(i + 1, o.tokens.length - 1);
      return Response.json({ token: o.tokens[i], expiresAt: null });
    }
    const auth = (init?.headers as Record<string, string>).Authorization;
    calls.sends.push(auth);
    return auth === `Bearer ${o.valid}` ? Response.json({ id: 1 }) : new Response("{}", { status: 401 });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

describe("configuration", () => {
  it("needs the inbox id and a token source, treats blanks as missing, and normalises our number", () => {
    expect(salesmsgConfig({})).toBeNull();
    expect(salesmsgConfig({ SALESMSG_API_TOKEN: "  ", SALESMSG_TEAM_ID: "1" })).toBeNull();
    expect(salesmsgConfig({ SALESMSG_TOKEN_URL: "https://wd.test/t", SALESMSG_TEAM_ID: "1" })).toBeNull();
    expect(salesmsgConfig(env)).toEqual({ token: "tok", broker: null, teamId: "4242", phoneNumber: "+18014570307", base: "https://api.salesmessage.com/pub/v2.3" });
    expect(salesmsgConfig({ ...broker, SALESMSG_TEAM_ID: "1" })?.broker).toEqual({ url: "https://wd.test/api/internal/salesmsg-token", secret: "share" });
  });

  it("builds links from APP_URL, else the request origin", () => {
    expect(appUrl("http://req.test", { APP_URL: "https://app.test/" })).toBe("https://app.test");
    expect(appUrl("http://req.test/", {})).toBe("http://req.test");
    expect(appUrl(null, {})).toBe("http://localhost:3000");
  });
});

describe("sendSms", () => {
  it("throws a clear error when texting is not configured", async () => {
    await expect(sendSms("+16195550123", "hi", { env: {} })).rejects.toBeInstanceOf(TextingNotConfiguredError);
  });

  it("posts to Salesmsg with the bearer token, our inbox and query parameters", async () => {
    const fetchMock = vi.fn(async () => Response.json({ id: 77 }));
    await expect(sendSms("+16195550123", "hello there", { env, fetchImpl: fetchMock as unknown as typeof fetch })).resolves.toEqual({ sid: "77" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.salesmessage.com/pub/v2.3/messages?number=%2B16195550123&team_id=4242&message=hello+there");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
  });

  it("does not put the number or body in its error", async () => {
    const fetchImpl = (async () => new Response("{}", { status: 400 })) as unknown as typeof fetch;
    const err = (await sendSms("+16195550123", "private words", { env, fetchImpl }).catch((e: Error) => e)) as Error;
    expect(err.message).toBe("Salesmsg refused the text (HTTP 400).");
  });
});

describe("token from WD Capital", () => {
  it("asks the broker once and reuses the token for ten minutes", async () => {
    const config = salesmsgConfig(benv)!;
    const { calls, fetchImpl } = world({ tokens: ["t1"], valid: "t1" });
    expect(await salesmsgToken(config, { fetchImpl, now: 0 })).toBe("t1");
    expect(await salesmsgToken(config, { fetchImpl, now: 9 * 60_000 })).toBe("t1");
    expect(calls.broker).toHaveLength(1);
    await salesmsgToken(config, { fetchImpl, now: 11 * 60_000 });
    expect(calls.broker).toHaveLength(2);
  });

  it("on a 401 reports the token as rejected (hashed) and retries once with the new one", async () => {
    const { calls, fetchImpl } = world({ tokens: ["old", "new"], valid: "new" });
    await expect(sendSms("+16195550123", "hi", { env: benv, fetchImpl })).resolves.toEqual({ sid: "1" });
    expect(calls.sends).toEqual(["Bearer old", "Bearer new"]);
    expect(calls.broker).toEqual([{}, { rejected: sha("old") }]);
  });

  it("gives up after one retry", async () => {
    const { calls, fetchImpl } = world({ tokens: ["a", "b"], valid: "zzz" });
    await expect(sendSms("+16195550123", "hi", { env: benv, fetchImpl })).rejects.toThrow("HTTP 401");
    expect(calls.sends).toHaveLength(2);
  });

  it("keeps using a cached token while the broker is down", async () => {
    const config = salesmsgConfig(benv)!;
    const up = world({ tokens: ["t1"], valid: "t1" });
    await salesmsgToken(config, { fetchImpl: up.fetchImpl, now: 0 });
    const down = world({ tokens: [], valid: "t1", brokerDown: true });
    expect(await salesmsgToken(config, { fetchImpl: down.fetchImpl, now: 60 * 60_000 })).toBe("t1");
  });

  it("fails clearly with no broker answer and nothing cached", async () => {
    const { fetchImpl } = world({ tokens: [], valid: "x", brokerDown: true });
    await expect(salesmsgToken(salesmsgConfig(benv)!, { fetchImpl })).rejects.toThrow("HTTP 502");
  });
});

describe("webhook", () => {
  it("compares the token exactly", () => {
    expect(isValidWebhookToken("s3cret", "s3cret")).toBe(true);
    expect(isValidWebhookToken("s3cret", "s3cre")).toBe(false);
    expect(isValidWebhookToken("s3cret", null)).toBe(false);
  });

  const config = { teamId: "4242", phoneNumber: "+18014570307" };
  const msg = { id: 5, status: "received", body: "new reel", received_at: "2026-11-17 10:00:00" };

  it("reads an inbound text to our inbox", () => {
    expect(parseIncomingText({ message: msg, contact: { number: "+16195550123" }, inbox: { id: 4242 } }, config)).toEqual({
      from: "+16195550123",
      body: "new reel",
      messageId: "5",
    });
  });

  it("reads Salesmsg's real envelope: { event, data: { message, contact, inbox, number } }", () => {
    const real = {
      event: "message.received",
      data: {
        message: { id: 742373204, conversation_id: 1, status: "received", type: "sms", body: "New story", received_at: "2026-11-18 00:01:57", sent_at: null },
        contact: { id: 1, number: "+14439359040" },
        inbox: { id: 4242, organization_id: 1 },
        number: { id: 256061, number: "+18014570307", numberable_id: 4242 },
      },
    };
    expect(parseIncomingText(real, config)).toEqual({ from: "+14439359040", body: "New story", messageId: "742373204" });
    expect(parseIncomingText({ ...real, event: "message.sent" }, config)).toBeNull();
    expect(parseIncomingText({ ...real, data: { ...real.data, inbox: { id: 223202 }, number: { number: "+18056000211" } } }, config)).toBeNull();
  });

  it("ignores other inboxes, outbound texts, calls and payloads without a message", () => {
    expect(parseIncomingText({ message: msg, contact: { number: "+16195550123" }, inbox: { id: 223202 } }, config)).toBeNull();
    expect(parseIncomingText({ message: msg, contact: { number: "+16195550123" } }, config)).toBeNull();
    expect(parseIncomingText({ message: { ...msg, status: "sent", sent_at: "x", received_at: null }, contact: { number: "+1" }, inbox: { id: 4242 } }, config)).toBeNull();
    expect(parseIncomingText({ message: { ...msg, type: "voicemail" }, contact: { number: "+1" }, inbox: { id: 4242 } }, config)).toBeNull();
    expect(parseIncomingText({ contact: { number: "+16195550123" } }, config)).toBeNull();
    expect(parseIncomingText("nope", config)).toBeNull();
  });
});

describe("normalizePhone", () => {
  it("normalises US and international numbers and rejects junk", () => {
    expect(normalizePhone("(619) 555-0123")).toBe("+16195550123");
    expect(normalizePhone("1 619 555 0123")).toBe("+16195550123");
    expect(normalizePhone("+44 20 7946 0958")).toBe("+442079460958");
    expect(normalizePhone("12345")).toBeNull();
  });

  it("masks a number for logs", () => {
    expect(maskPhone("+16195550123")).toBe("•••0123");
  });
});
