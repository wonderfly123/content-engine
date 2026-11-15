import { afterEach, describe, expect, it, vi } from "vitest";
import { maskPhone, normalizePhone } from "../phone";
import { appUrl, isValidTwilioSignature, sendSms, TextingNotConfiguredError, twilioConfig, twilioSignature, twiml } from "../twilio";

// The worked example from Twilio's request-validation documentation.
const authToken = "12345";
const url = "https://mycompany.com/myapp.php?foo=1&bar=2";
const params = {
  CallSid: "CA1234567890ABCDE",
  Caller: "+12349013030",
  Digits: "1234",
  From: "+12349013030",
  To: "+18005551212",
};
const documented = "0/KCTR6DLpKmkAf8muzZqo1nDgQ=";

describe("twilioSignature", () => {
  it("matches Twilio's documented example", () => {
    expect(twilioSignature(authToken, url, params)).toBe(documented);
  });

  it("accepts the right signature", () => {
    expect(isValidTwilioSignature(authToken, url, params, documented)).toBe(true);
  });

  it("rejects a changed parameter, a wrong token, a different URL and a missing header", () => {
    expect(isValidTwilioSignature(authToken, url, { ...params, From: "+10000000000" }, documented)).toBe(false);
    expect(isValidTwilioSignature("other", url, params, documented)).toBe(false);
    expect(isValidTwilioSignature(authToken, "https://mycompany.com/other", params, documented)).toBe(false);
    expect(isValidTwilioSignature(authToken, url, params, null)).toBe(false);
  });
});

describe("twiml", () => {
  it("wraps and escapes a message", () => {
    expect(twiml('Tom & "Jerry" <3')).toBe(
      '<?xml version="1.0" encoding="UTF-8"?><Response><Message>Tom &amp; &quot;Jerry&quot; &lt;3</Message></Response>',
    );
  });

  it("is an empty response with no message", () => {
    expect(twiml(null)).toBe('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
  });
});

describe("configuration", () => {
  it("needs all three keys, and treats blanks as missing", () => {
    expect(twilioConfig({})).toBeNull();
    expect(twilioConfig({ TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: "  ", TWILIO_PHONE_NUMBER: "+16195550123" })).toBeNull();
    expect(twilioConfig({ TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: "t", TWILIO_PHONE_NUMBER: "+16195550123" })).toEqual({
      accountSid: "AC1",
      authToken: "t",
      phoneNumber: "+16195550123",
    });
  });

  it("builds links from APP_URL, else the request origin", () => {
    expect(appUrl("http://req.test", { APP_URL: "https://app.test/" })).toBe("https://app.test");
    expect(appUrl("http://req.test/", {})).toBe("http://req.test");
    expect(appUrl(null, {})).toBe("http://localhost:3000");
  });
});

describe("sendSms", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
    vi.unstubAllGlobals();
  });

  it("throws a clear error when texting is not configured", async () => {
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;
    delete process.env.TWILIO_PHONE_NUMBER;
    await expect(sendSms("+16195550123", "hi")).rejects.toBeInstanceOf(TextingNotConfiguredError);
    await expect(sendSms("+16195550123", "hi")).rejects.toThrow(/not configured/);
  });

  it("posts to Twilio's REST API with basic auth and no SDK", async () => {
    process.env.TWILIO_ACCOUNT_SID = "AC123";
    process.env.TWILIO_AUTH_TOKEN = "secret";
    process.env.TWILIO_PHONE_NUMBER = "+15550001111";
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ sid: "SM1" }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(sendSms("+16195550123", "hello")).resolves.toEqual({ sid: "SM1" });
    const [calledUrl, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(calledUrl).toBe("https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json");
    expect((init.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from("AC123:secret").toString("base64")}`);
    expect(String(init.body)).toBe("To=%2B16195550123&From=%2B15550001111&Body=hello");
  });

  it("does not put the number or body in its error", async () => {
    process.env.TWILIO_ACCOUNT_SID = "AC123";
    process.env.TWILIO_AUTH_TOKEN = "secret";
    process.env.TWILIO_PHONE_NUMBER = "+15550001111";
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 400 }));
    const err = (await sendSms("+16195550123", "private words").catch((e: Error) => e)) as Error;
    expect(err.message).not.toContain("6195550123");
    expect(err.message).not.toContain("private");
  });
});

describe("normalizePhone", () => {
  it("normalises US numbers", () => {
    expect(normalizePhone("(619) 555-0123")).toBe("+16195550123");
    expect(normalizePhone("1 619 555 0123")).toBe("+16195550123");
    expect(normalizePhone("+16195550123")).toBe("+16195550123");
  });

  it("keeps international numbers that start with +", () => {
    expect(normalizePhone("+44 20 7946 0958")).toBe("+442079460958");
  });

  it("rejects things that are not phone numbers", () => {
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone("12345")).toBeNull();
    expect(normalizePhone("+123")).toBeNull();
  });

  it("masks a number for logs", () => {
    expect(maskPhone("+16195550123")).toBe("•••0123");
  });
});
