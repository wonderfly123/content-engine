/**
 * Private media storage on Cloudflare R2, through its S3-compatible API.
 *
 * Requests are signed here with AWS Signature Version 4 (node:crypto only, no SDK): R2 takes the
 * region "auto" and the service "s3", path-style URLs `https://<account>.r2.cloudflarestorage.com/<bucket>/<key>`.
 * Keys come from lib/storage/keys.ts only. Nothing here logs keys, credentials or signed URLs;
 * errors carry the operation, the HTTP status and R2's error code, never the URL.
 */
import { createHash, createHmac } from "node:crypto";

export class StorageNotConfiguredError extends Error {
  constructor() {
    super("Storage is not configured (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET).");
    this.name = "StorageNotConfiguredError";
  }
}

export class StorageRequestError extends Error {
  constructor(
    public readonly operation: string,
    public readonly status: number,
    public readonly code: string | null,
  ) {
    super(`Storage ${operation} failed (${status}${code ? ` ${code}` : ""}).`);
    this.name = "StorageRequestError";
  }
}

interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

export function r2Config(): R2Config {
  const accountId = process.env.R2_ACCOUNT_ID?.trim();
  const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();
  const bucket = process.env.R2_BUCKET?.trim();
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) throw new StorageNotConfiguredError();
  // These go into the host name and path: refuse anything that could change where a request goes.
  if (!/^[A-Za-z0-9-]+$/.test(accountId) || !/^[a-z0-9.-]+$/.test(bucket)) throw new StorageNotConfiguredError();
  return { accountId, accessKeyId, secretAccessKey, bucket };
}

export const isStorageConfigured = (): boolean => {
  try {
    r2Config();
    return true;
  } catch {
    return false;
  }
};

// ---- Signature Version 4 ----------------------------------------------------------------------

export interface SigningCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  service: string;
}

export interface SignInput {
  method: string;
  host: string;
  /** Unencoded path, starting with "/". */
  path: string;
  query?: Record<string, string>;
  /** Extra headers to sign (lower-case names); `host` is added automatically. */
  headers?: Record<string, string>;
  payloadHash: string;
  date: Date;
  creds: SigningCredentials;
}

export const UNSIGNED_PAYLOAD = "UNSIGNED-PAYLOAD";
export const sha256Hex = (data: string | Buffer): string => createHash("sha256").update(data).digest("hex");
const hmac = (key: Buffer | string, data: string): Buffer => createHmac("sha256", key).update(data).digest();

/** RFC 3986 encoding as SigV4 wants it; `/` kept in paths. */
export function uriEncode(value: string, keepSlash = false): string {
  const out = encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return keepSlash ? out.replace(/%2F/g, "/") : out;
}

export function canonicalQuery(query: Record<string, string> = {}): string {
  return Object.entries(query)
    .map(([k, v]) => [uriEncode(k), uriEncode(v)] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
}

const amzDate = (date: Date) => date.toISOString().replace(/[:-]|\.\d{3}/g, "");

export function canonicalRequest(input: SignInput): { canonical: string; signedHeaders: string } {
  const headers: Record<string, string> = { ...lower(input.headers ?? {}), host: input.host };
  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((n) => `${n}:${headers[n].trim().replace(/\s+/g, " ")}\n`).join("");
  const signedHeaders = names.join(";");
  const canonical = [input.method, uriEncode(input.path, true), canonicalQuery(input.query), canonicalHeaders, signedHeaders, input.payloadHash].join("\n");
  return { canonical, signedHeaders };
}

function lower(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
}

function sign(creds: SigningCredentials, date: Date, canonical: string): { scope: string; signature: string } {
  const stamp = amzDate(date);
  const day = stamp.slice(0, 8);
  const scope = `${day}/${creds.region}/${creds.service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", stamp, scope, sha256Hex(canonical)].join("\n");
  const key = hmac(hmac(hmac(hmac(`AWS4${creds.secretAccessKey}`, day), creds.region), creds.service), "aws4_request");
  return { scope, signature: createHmac("sha256", key).update(stringToSign).digest("hex") };
}

/** Headers for a signed request: the given ones plus x-amz-date, x-amz-content-sha256, authorization. */
export function signHeaders(input: SignInput): Record<string, string> {
  const headers = { ...lower(input.headers ?? {}), "x-amz-date": amzDate(input.date), "x-amz-content-sha256": input.payloadHash };
  const { canonical, signedHeaders } = canonicalRequest({ ...input, headers });
  const { scope, signature } = sign(input.creds, input.date, canonical);
  return { ...headers, authorization: `AWS4-HMAC-SHA256 Credential=${input.creds.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}` };
}

/** A presigned URL (query-string auth), signing only the host header. */
export function presignUrl(input: Omit<SignInput, "headers" | "payloadHash"> & { expiresIn: number }): string {
  const stamp = amzDate(input.date);
  const query = {
    ...(input.query ?? {}),
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${input.creds.accessKeyId}/${stamp.slice(0, 8)}/${input.creds.region}/${input.creds.service}/aws4_request`,
    "X-Amz-Date": stamp,
    "X-Amz-Expires": String(Math.floor(input.expiresIn)),
    "X-Amz-SignedHeaders": "host",
  };
  const { canonical } = canonicalRequest({ ...input, query, payloadHash: UNSIGNED_PAYLOAD });
  const { signature } = sign(input.creds, input.date, canonical);
  return `https://${input.host}${uriEncode(input.path, true)}?${canonicalQuery(query)}&X-Amz-Signature=${signature}`;
}

// ---- R2 operations ----------------------------------------------------------------------------

function target(key: string) {
  const cfg = r2Config();
  const creds: SigningCredentials = { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey, region: "auto", service: "s3" };
  return { creds, host: `${cfg.accountId}.r2.cloudflarestorage.com`, path: `/${cfg.bucket}/${key}` };
}

async function send(operation: string, method: string, key: string, opts: { query?: Record<string, string>; headers?: Record<string, string>; body?: string } = {}): Promise<Response> {
  const { creds, host, path } = target(key);
  const query = opts.query ?? {};
  const headers = signHeaders({ method, host, path, query, headers: opts.headers, payloadHash: sha256Hex(opts.body ?? ""), date: new Date(), creds });
  const qs = Object.entries(query).map(([k, v]) => (v === "" ? uriEncode(k) : `${uriEncode(k)}=${uriEncode(v)}`)).join("&");
  const res = await fetch(`https://${host}${uriEncode(path, true)}${qs ? `?${qs}` : ""}`, { method, headers, body: opts.body });
  if (!res.ok) throw new StorageRequestError(operation, res.status, method === "HEAD" ? null : errorCode(await res.text().catch(() => "")));
  return res;
}

const errorCode = (xml: string) => /<Code>([^<]+)<\/Code>/.exec(xml)?.[1] ?? null;
const xmlEscape = (s: string) => s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]!);

export async function createMultipartUpload(key: string, contentType: string): Promise<string> {
  const res = await send("create upload", "POST", key, { query: { uploads: "" }, headers: { "content-type": contentType } });
  const uploadId = /<UploadId>([^<]+)<\/UploadId>/.exec(await res.text())?.[1];
  if (!uploadId) throw new StorageRequestError("create upload", res.status, "NoUploadId");
  return uploadId;
}

export interface CompletedPart {
  partNumber: number;
  etag: string;
}

export async function completeMultipartUpload(key: string, uploadId: string, parts: CompletedPart[]): Promise<void> {
  const body = `<CompleteMultipartUpload>${[...parts]
    .sort((a, b) => a.partNumber - b.partNumber)
    .map((p) => `<Part><PartNumber>${p.partNumber}</PartNumber><ETag>${xmlEscape(p.etag)}</ETag></Part>`)
    .join("")}</CompleteMultipartUpload>`;
  const res = await send("complete upload", "POST", key, { query: { uploadId }, headers: { "content-type": "application/xml" }, body });
  // S3-style APIs can answer 200 with an error in the body.
  const text = await res.text();
  if (/<Error>/.test(text)) throw new StorageRequestError("complete upload", res.status, errorCode(text));
}

export async function abortMultipartUpload(key: string, uploadId: string): Promise<void> {
  try {
    await send("abort upload", "DELETE", key, { query: { uploadId } });
  } catch (err) {
    if (err instanceof StorageRequestError && err.status === 404) return; // already gone
    throw err;
  }
}

export function presignUploadPart(key: string, uploadId: string, partNumber: number, expiresIn = 3600): string {
  const { creds, host, path } = target(key);
  return presignUrl({ method: "PUT", host, path, query: { partNumber: String(partNumber), uploadId }, date: new Date(), creds, expiresIn });
}

/** A short-lived link to read a private object (default 10 minutes). */
export function presignGet(key: string, expiresIn = 600): string {
  const { creds, host, path } = target(key);
  return presignUrl({ method: "GET", host, path, date: new Date(), creds, expiresIn });
}

/** How an asset stored on our private R2 bucket is recorded in `assets.storage_url`: r2://<key>. */
export const R2_URI_PREFIX = "r2://";

/**
 * A URL someone outside (Instagram) can fetch: r2://<key> becomes a presigned GET (default 6 hours,
 * made at publish time so it never goes stale while a post waits); anything else is returned as is.
 */
export function resolveStorageUrl(storageUrl: string, expiresIn = 6 * 60 * 60): string {
  return storageUrl.startsWith(R2_URI_PREFIX) ? presignGet(storageUrl.slice(R2_URI_PREFIX.length), expiresIn) : storageUrl;
}

/** A short-lived link to write one object with a single PUT (the optimizer's output). */
export function presignPut(key: string, expiresIn = 7200): string {
  const { creds, host, path } = target(key);
  return presignUrl({ method: "PUT", host, path, date: new Date(), creds, expiresIn });
}

export interface ObjectHead {
  size: number;
  contentType: string | null;
  etag: string | null;
}

/** The object's size and type, or null when it does not exist. */
export async function headObject(key: string): Promise<ObjectHead | null> {
  try {
    const res = await send("head", "HEAD", key);
    return { size: Number(res.headers.get("content-length") ?? NaN), contentType: res.headers.get("content-type"), etag: res.headers.get("etag") };
  } catch (err) {
    if (err instanceof StorageRequestError && err.status === 404) return null;
    throw err;
  }
}

export async function deleteObject(key: string): Promise<void> {
  await send("delete", "DELETE", key);
}
