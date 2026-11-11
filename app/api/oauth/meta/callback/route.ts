/**
 * Meta OAuth callback. Used by onboarding Step 7.
 *
 * Flow:
 *   1. Exchange `code` for a short-lived user access token
 *   2. Exchange short→long-lived (60-day) user token
 *   3. Fetch user's FB Pages list (need at least one)
 *      - If multi-page and no ?page_id= → return 200 JSON with the list so
 *        the client can prompt selection (a future UI Task 9 will own the
 *        selection screen — for v1 we redirect to a simple page).
 *   4. Fetch the IG Business Account linked to the selected FB Page
 *   5. Upsert `channel_connections` rows for facebook + instagram
 *
 * `state` carries `brandId|nonce` so we know which brand to wire connections
 * onto. Tokens are stored via the `encryptedText` column transformer.
 */

import { NextResponse, type NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { channelConnections, events } from "@/lib/db/schema";
import type { ConnectedAdAccount } from "@/lib/db/types";

export const runtime = "nodejs";

const META_API = "https://graph.facebook.com/v21.0";

const META_SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "instagram_basic",
  "instagram_content_publish",
  "instagram_manage_insights",
  "pages_manage_posts",
  "read_insights",
  "ads_read",
  "business_management",
];

const stateSchema = z
  .string()
  .min(1)
  .transform((s) => {
    const [brandId, nonce] = s.split("|");
    return { brandId, nonce };
  })
  .pipe(
    z.object({
      brandId: z.string().uuid("state must encode a uuid brand id"),
      nonce: z.string().optional(),
    }),
  );

interface MetaTokenResponse {
  access_token: string;
  token_type?: string;
  expires_in?: number;
}

interface MetaPage {
  id: string;
  name: string;
  access_token: string;
  instagram_business_account?: { id: string };
}

interface MetaAdAccount {
  id: string; // "act_…"
  account_id: string; // raw numeric
  name: string;
  currency?: string;
  account_status?: number;
  business?: { id: string; name?: string };
}

async function graphGet<T>(path: string, params: Record<string, string>): Promise<T> {
  const url = new URL(`${META_API}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), { method: "GET" });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Meta Graph ${path} ${res.status}: ${text.slice(0, 500)}`);
  }
  return (await res.json()) as T;
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const code = sp.get("code");
  const stateRaw = sp.get("state");
  const errorParam = sp.get("error");
  const pageIdOverride = sp.get("page_id");

  if (errorParam) {
    return NextResponse.json(
      { error: "Meta OAuth denied", detail: errorParam },
      { status: 400 },
    );
  }
  if (!code || !stateRaw) {
    return NextResponse.json(
      { error: "Missing code or state" },
      { status: 400 },
    );
  }

  const stateParsed = stateSchema.safeParse(stateRaw);
  if (!stateParsed.success) {
    return NextResponse.json(
      { error: "Invalid state", issues: stateParsed.error.flatten() },
      { status: 400 },
    );
  }
  const { brandId } = stateParsed.data;

  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  const redirectUri =
    process.env.META_OAUTH_REDIRECT_URI ??
    `${req.nextUrl.origin}/api/oauth/meta/callback`;

  if (!appId || !appSecret) {
    return NextResponse.json(
      { error: "Meta OAuth not configured (META_APP_ID/SECRET missing)" },
      { status: 500 },
    );
  }

  try {
    // 1) short-lived token
    const short = await graphGet<MetaTokenResponse>("/oauth/access_token", {
      client_id: appId,
      client_secret: appSecret,
      redirect_uri: redirectUri,
      code,
    });

    // 2) long-lived (60-day) token
    const long = await graphGet<MetaTokenResponse>("/oauth/access_token", {
      grant_type: "fb_exchange_token",
      client_id: appId,
      client_secret: appSecret,
      fb_exchange_token: short.access_token,
    });
    const userToken = long.access_token;
    const expiresAt = long.expires_in
      ? new Date(Date.now() + long.expires_in * 1000)
      : null;

    // 3) list pages
    const pagesRes = await graphGet<{ data: MetaPage[] }>("/me/accounts", {
      access_token: userToken,
      fields: "id,name,access_token,instagram_business_account",
    });
    const pages = pagesRes.data ?? [];

    if (pages.length === 0) {
      return NextResponse.json(
        { error: "No Facebook Pages found on this account" },
        { status: 400 },
      );
    }

    // If multi-page and no override, surface the list to the client.
    let page = pages[0];
    if (pages.length > 1) {
      if (pageIdOverride) {
        const match = pages.find((p) => p.id === pageIdOverride);
        if (!match) {
          return NextResponse.json(
            { error: "page_id not in user's page list" },
            { status: 400 },
          );
        }
        page = match;
      } else {
        return NextResponse.json({
          needsPageSelection: true,
          pages: pages.map((p) => ({ id: p.id, name: p.name })),
        });
      }
    }
    if (!page) {
      return NextResponse.json(
        { error: "Failed to select a Page" },
        { status: 400 },
      );
    }

    const fbPageId = page.id;
    const pageToken = page.access_token;

    // 4) IG business account linked to page (fetched explicitly in case the
    //    /me/accounts response didn't include it).
    let igBusinessId = page.instagram_business_account?.id;
    if (!igBusinessId) {
      try {
        const linked = await graphGet<{
          instagram_business_account?: { id: string };
        }>(`/${fbPageId}`, {
          fields: "instagram_business_account",
          access_token: pageToken,
        });
        igBusinessId = linked.instagram_business_account?.id;
      } catch {
        igBusinessId = undefined;
      }
    }

    // 4b) list ad accounts visible to the granting user (ads_read scope).
    //     If 0, the brand is organic-only — that's fine.
    //     If 1, auto-select.
    //     If >1 and no ?ad_account_id= override → surface picker.
    const adAccountIdOverride = sp.get("ad_account_id");
    const adAccountsRes = await graphGet<{ data: MetaAdAccount[] }>(
      "/me/adaccounts",
      {
        access_token: userToken,
        fields: "id,account_id,name,currency,account_status,business",
        limit: "200",
      },
    ).catch(() => ({ data: [] as MetaAdAccount[] }));
    const adAccounts = adAccountsRes.data ?? [];
    const adAccountsForMeta: ConnectedAdAccount[] = adAccounts.map((a) => ({
      id: a.id,
      name: a.name,
      currency: a.currency,
      accountStatus: a.account_status,
      businessId: a.business?.id,
      businessName: a.business?.name,
    }));

    let selectedAdAccount: MetaAdAccount | undefined;
    if (adAccounts.length === 1) {
      selectedAdAccount = adAccounts[0];
    } else if (adAccounts.length > 1) {
      if (adAccountIdOverride) {
        selectedAdAccount = adAccounts.find(
          (a) => a.id === adAccountIdOverride,
        );
        if (!selectedAdAccount) {
          return NextResponse.json(
            { error: "ad_account_id not in user's ad account list" },
            { status: 400 },
          );
        }
      } else {
        return NextResponse.json({
          needsAdAccountSelection: true,
          pageId: fbPageId,
          adAccounts: adAccountsForMeta,
        });
      }
    }

    // 5) upsert connections
    const baseMeta: Record<string, unknown> = {
      fbPageId,
      scopes: META_SCOPES,
      adAccounts: adAccountsForMeta,
    };
    if (selectedAdAccount) {
      baseMeta.adAccountId = selectedAdAccount.id;
      baseMeta.adAccountName = selectedAdAccount.name;
      baseMeta.adAccountCurrency = selectedAdAccount.currency;
      baseMeta.adAccountBusinessId = selectedAdAccount.business?.id;
    }

    await upsertConnection(brandId, "facebook", {
      externalAccountId: fbPageId,
      token: pageToken,
      expiresAt,
      meta: baseMeta,
    });

    if (igBusinessId) {
      await upsertConnection(brandId, "instagram", {
        externalAccountId: igBusinessId,
        token: pageToken, // IG Graph operates with the Page token
        expiresAt,
        meta: { ...baseMeta, igBusinessId },
      });
    }

    await db.insert(events).values({
      entityType: "brand",
      entityId: brandId,
      actor: "user",
      note:
        `Onboarding step 7: connected Meta ` +
        `(page=${fbPageId}, ig=${igBusinessId ?? "none"}, ` +
        `ads=${selectedAdAccount?.id ?? (adAccounts.length === 0 ? "none" : "unset")})`,
    });

    return NextResponse.redirect(
      new URL(`/onboarding/${brandId}?step=7&connected=1`, req.nextUrl.origin),
    );
  } catch (err) {
    const detail = (err as Error).message;
    await db.insert(events).values({
      entityType: "brand",
      entityId: brandId,
      actor: "system",
      note: `Meta OAuth failed: ${detail}`,
    });
    return NextResponse.json(
      { error: "Meta OAuth failed", detail },
      { status: 500 },
    );
  }
}

interface UpsertArgs {
  externalAccountId: string;
  token: string;
  expiresAt: Date | null;
  meta: Record<string, unknown>;
}

async function upsertConnection(
  brandId: string,
  channel: "facebook" | "instagram",
  args: UpsertArgs,
): Promise<void> {
  const [existing] = await db
    .select({ id: channelConnections.id })
    .from(channelConnections)
    .where(
      and(
        eq(channelConnections.brandId, brandId),
        eq(channelConnections.channel, channel),
      ),
    );

  if (existing) {
    await db
      .update(channelConnections)
      .set({
        externalAccountId: args.externalAccountId,
        accessToken: args.token,
        tokenExpiresAt: args.expiresAt,
        status: "connected",
        connectedAt: new Date(),
        metaJson: args.meta,
      })
      .where(eq(channelConnections.id, existing.id));
  } else {
    await db.insert(channelConnections).values({
      brandId,
      channel,
      externalAccountId: args.externalAccountId,
      accessToken: args.token,
      tokenExpiresAt: args.expiresAt,
      status: "connected",
      metaJson: args.meta,
    });
  }
}

