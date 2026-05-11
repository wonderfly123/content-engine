/**
 * Cron handler auth. Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`.
 * Every `app/api/cron/*` route MUST call `assertCronAuth(request)` first.
 *
 * In production we require `CRON_SECRET` to be set. In tests/dev where it is
 * unset, we still demand the bearer header match to keep handlers safe by
 * default — callers must explicitly set `CRON_SECRET` to use the routes.
 */

export class CronAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CronAuthError";
  }
}

export function assertCronAuth(request: Request): void {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    throw new CronAuthError("CRON_SECRET is not configured");
  }
  const header = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  if (header !== expected) {
    throw new CronAuthError("Unauthorized cron request");
  }
}

/**
 * Wrap a cron handler with bearer-token auth and a uniform JSON error shape.
 * Returns a `Response`-producing function compatible with App Router routes.
 */
export function withCronAuth<T>(
  handler: (request: Request) => Promise<T>,
): (request: Request) => Promise<Response> {
  return async (request) => {
    try {
      assertCronAuth(request);
    } catch (err) {
      return Response.json(
        { ok: false, error: (err as Error).message },
        { status: 401 },
      );
    }
    try {
      const result = await handler(request);
      return Response.json({ ok: true, ...(result as object) });
    } catch (err) {
      return Response.json(
        { ok: false, error: (err as Error).message },
        { status: 500 },
      );
    }
  };
}
