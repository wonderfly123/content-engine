/**
 * Shared answers for the upload routes.
 */
import { NextResponse } from "next/server";
import { StorageNotConfiguredError, StorageRequestError } from "@/lib/storage/r2";

export const fail = (status: number, error: string, message: string, extra: Record<string, unknown> = {}) =>
  NextResponse.json({ error, message, ...extra }, { status });

/** A thread that is closed takes no more clips. */
export const threadClosed = () => fail(409, "thread_closed", "This conversation is closed. Start a new reel or story to add clips.");

/** Runs storage work; a missing configuration answers 503, a storage failure 502. Other errors pass through. */
export async function withStorage(work: () => Promise<Response>): Promise<Response> {
  try {
    return await work();
  } catch (err) {
    if (err instanceof StorageNotConfiguredError) return fail(503, "storage_not_configured", "Clip uploads are not set up yet.");
    if (err instanceof StorageRequestError) return fail(502, "storage_error", err.message);
    throw err;
  }
}

/** Parses a JSON body, or null. */
export const jsonBody = async (req: Request): Promise<unknown> => req.json().catch(() => null);
