/**
 * The shape of one cross-workspace attempt. Each group of routes keeps its attempts in its own
 * `attacks-*.ts` file next to this one; `index.ts` joins them.
 *
 * Every attempt must be a request that would WORK for the victim themself (valid ids, valid body),
 * so that a refusal proves the ownership check and not a validation error. The test runs each
 * attempt twice: as the attacker (must be refused, must change nothing, must leak nothing) and
 * then as the victim (must not be refused as "not yours").
 */
import type { Seeded } from "./world";

export type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

export interface RouteRequest {
  /** Values for the route's `[segments]`. */
  params?: Record<string, string>;
  query?: Record<string, string>;
  /** JSON body. */
  body?: unknown;
  /** Multipart form body (used instead of `body`). */
  form?: Record<string, string | Blob>;
}

export interface RouteAttack {
  /** Repo-relative route file, e.g. "app/api/briefs/[id]/approve/route.ts". */
  route: string;
  method: Method;
  /** A request aimed at the victim's data. `attacker` is there for mixed requests (own brand, their record). */
  build: (victim: Seeded, attacker: Seeded) => RouteRequest;
  /** Short label when a route has several attempts. */
  name?: string;
  /**
   * For routes that name no brand (lists across the caller's brands, creating a brand): the
   * attacker's call may succeed, with the reason. It must still leak and change nothing of the victim's.
   */
  attackerMayPass?: string;
  /**
   * Skip the "victim is allowed" control, with the reason (for example: the route needs files on
   * this machine, or only the platform admin may use it).
   */
  skipOwnerControl?: string;
}

export interface ActionAttack {
  /** Repo-relative file with "use server", e.g. "app/settings/actions.ts". */
  file: string;
  /** Exported function name. */
  action: string;
  /** Arguments aimed at the victim's data. */
  args: (victim: Seeded, attacker: Seeded) => unknown[];
  name?: string;
  /**
   * For actions that name no brand and act on the caller's own workspace: the attacker's call may
   * succeed, with the reason. It must still leak and change nothing of the victim's.
   */
  attackerMayPass?: string;
  skipOwnerControl?: string;
}
