/**
 * SigV4 signing is checked against AWS's own published examples for S3 (the "Signature Calculations
 * for the Authorization Header" GET Object example and the "Query String Authentication" presigned
 * URL example, both for examplebucket / AKIAIOSFODNN7EXAMPLE on 2013-05-24, us-east-1). The signer is
 * generic over host, region and service, so matching those known-good signatures proves the
 * canonical request, string-to-sign and key derivation; R2 only changes the inputs (host, region
 * "auto"). The R2 operations are then checked for request shape with fetch stubbed (never the real R2).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  completeMultipartUpload,
  createMultipartUpload,
  headObject,
  presignGet,
  presignUploadPart,
  presignUrl,
  signHeaders,
  StorageNotConfiguredError,
  StorageRequestError,
  type SigningCredentials,
} from "../r2";

const AWS: SigningCredentials = {
  accessKeyId: "AKIAIOSFODNN7EXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  region: "us-east-1",
  service: "s3",
};
const DATE = new Date("2013-05-24T00:00:00Z");
const EMPTY_SHA = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

describe("SigV4 against AWS's published examples", () => {
  it("signs the GET Object example's Authorization header", () => {
    const headers = signHeaders({
      method: "GET",
      host: "examplebucket.s3.amazonaws.com",
      path: "/test.txt",
      headers: { range: "bytes=0-9" },
      payloadHash: EMPTY_SHA,
      date: DATE,
      creds: AWS,
    });
    expect(headers.authorization).toBe(
      "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, " +
        "SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, " +
        "Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41",
    );
    expect(headers["x-amz-date"]).toBe("20130524T000000Z");
  });

  it("signs the presigned GET example", () => {
    const url = presignUrl({ method: "GET", host: "examplebucket.s3.amazonaws.com", path: "/test.txt", date: DATE, creds: AWS, expiresIn: 86400 });
    expect(url).toBe(
      "https://examplebucket.s3.amazonaws.com/test.txt?X-Amz-Algorithm=AWS4-HMAC-SHA256" +
        "&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request" +
        "&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host" +
        "&X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404",
    );
  });
});

describe("R2 operations", () => {
  const env = { R2_ACCOUNT_ID: "acct123", R2_ACCESS_KEY_ID: "key-id", R2_SECRET_ACCESS_KEY: "secret", R2_BUCKET: "nekter-media" };
  const KEY = "ws/00000000-0000-4000-8000-000000000001/conv/00000000-0000-4000-8000-000000000002/raw/00000000-0000-4000-8000-000000000003-clip.mov";
  let calls: Array<{ url: string; init: RequestInit }>;

  beforeEach(() => {
    Object.assign(process.env, env);
    calls = [];
  });
  afterEach(() => {
    for (const k of Object.keys(env)) delete process.env[k];
    vi.unstubAllGlobals();
  });
  const respond = (res: Response) =>
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return res;
    });

  it("says storage is not configured when env is missing", () => {
    delete process.env.R2_BUCKET;
    expect(() => presignGet(KEY)).toThrow(StorageNotConfiguredError);
  });

  it("presigns part uploads and reads for the account's endpoint, path-style, region auto", () => {
    const part = new URL(presignUploadPart(KEY, "up-1", 7));
    expect(part.host).toBe("acct123.r2.cloudflarestorage.com");
    expect(part.pathname).toBe(`/nekter-media/${KEY}`);
    expect(part.searchParams.get("partNumber")).toBe("7");
    expect(part.searchParams.get("uploadId")).toBe("up-1");
    expect(part.searchParams.get("X-Amz-Credential")).toMatch(/^key-id\/\d{8}\/auto\/s3\/aws4_request$/);
    expect(part.searchParams.get("X-Amz-Expires")).toBe("3600");
    expect(part.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
    expect(new URL(presignGet(KEY)).searchParams.get("X-Amz-Expires")).toBe("600");
    expect(new URL(presignGet(KEY)).searchParams.has("response-content-disposition")).toBe(false);
    const dl = new URL(presignGet(KEY, 600, { downloadAs: 'Cider "Stand"/Opening.mp4' }));
    expect(dl.searchParams.get("response-content-disposition")).toBe('attachment; filename="Cider StandOpening.mp4"');
  });

  it("creates a multipart upload and reads its id", async () => {
    respond(new Response("<InitiateMultipartUploadResult><UploadId>abc-123</UploadId></InitiateMultipartUploadResult>"));
    expect(await createMultipartUpload(KEY, "video/quicktime")).toBe("abc-123");
    expect(calls[0].url).toBe(`https://acct123.r2.cloudflarestorage.com/nekter-media/${KEY}?uploads`);
    const headers = calls[0].init.headers as Record<string, string>;
    expect(calls[0].init.method).toBe("POST");
    expect(headers.authorization).toMatch(/SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date/);
    expect(headers["content-type"]).toBe("video/quicktime");
  });

  it("completes with parts in order and treats an error body as a failure", async () => {
    respond(new Response("<CompleteMultipartUploadResult/>"));
    await completeMultipartUpload(KEY, "up-1", [{ partNumber: 2, etag: '"b"' }, { partNumber: 1, etag: '"a"' }]);
    expect(calls[0].init.body).toBe(
      "<CompleteMultipartUpload><Part><PartNumber>1</PartNumber><ETag>&quot;a&quot;</ETag></Part><Part><PartNumber>2</PartNumber><ETag>&quot;b&quot;</ETag></Part></CompleteMultipartUpload>",
    );
    respond(new Response("<Error><Code>InvalidPart</Code></Error>"));
    await expect(completeMultipartUpload(KEY, "up-1", [{ partNumber: 1, etag: "x" }])).rejects.toMatchObject({ code: "InvalidPart" });
  });

  it("heads an object, null when missing, and never puts the URL in errors", async () => {
    respond(new Response(null, { status: 200, headers: { "content-length": "12345", "content-type": "video/mp4" } }));
    expect(await headObject(KEY)).toMatchObject({ size: 12345, contentType: "video/mp4" });
    respond(new Response(null, { status: 404 }));
    expect(await headObject(KEY)).toBeNull();
    respond(new Response("<Error><Code>AccessDenied</Code></Error>", { status: 403 }));
    const err = await createMultipartUpload(KEY, "video/mp4").catch((e) => e);
    expect(err).toBeInstanceOf(StorageRequestError);
    expect(err.message).not.toContain("r2.cloudflarestorage.com");
    expect(err.message).not.toContain("secret");
  });
});
