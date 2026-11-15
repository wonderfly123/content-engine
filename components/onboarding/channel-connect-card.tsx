"use client";

import { Check, ExternalLink, Facebook, Instagram } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface ChannelConnectCardProps {
  channel: "instagram" | "facebook";
  brandId: string;
  connected: boolean;
  /** Public Meta App ID, exposed via NEXT_PUBLIC_META_APP_ID env. */
  appId?: string;
  /** Redirect URI registered with Meta. */
  redirectUri?: string;
}

/** Must match the name the callback reads (app/api/oauth/meta/callback/route.ts). */
const OAUTH_NONCE_COOKIE = "ce_meta_oauth";

const SCOPES = [
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

export function ChannelConnectCard({
  channel,
  brandId,
  connected,
  appId,
  redirectUri,
}: ChannelConnectCardProps) {
  const Icon = channel === "instagram" ? Instagram : Facebook;
  const label = channel === "instagram" ? "Instagram" : "Facebook";

  const buildAuthUrl = (nonce: string): string | null => {
    if (!appId || !redirectUri) return null;
    const state = `${brandId}|${nonce}`;
    const url = new URL("https://www.facebook.com/v21.0/dialog/oauth");
    url.searchParams.set("client_id", appId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("state", state);
    url.searchParams.set("scope", SCOPES.join(","));
    url.searchParams.set("response_type", "code");
    return url.toString();
  };

  const canConnect = Boolean(appId && redirectUri);

  /**
   * Start the Meta sign-in. A one-time value goes into both the link and a short-lived cookie;
   * the callback only accepts a return that carries the same value, so a link crafted by someone
   * else cannot attach their account to this brand.
   */
  const connect = () => {
    const nonce = crypto.randomUUID();
    const url = buildAuthUrl(nonce);
    if (!url) return;
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${OAUTH_NONCE_COOKIE}=${nonce}; Path=/api/oauth/meta; Max-Age=900; SameSite=Lax${secure}`;
    window.location.assign(url);
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className="h-5 w-5" aria-hidden="true" />
          {label}
        </CardTitle>
        {connected && (
          <span className="flex items-center gap-1 text-xs font-medium text-green-600">
            <Check className="h-3.5 w-3.5" aria-hidden="true" />
            Connected
          </span>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          {channel === "instagram"
            ? "Connect an Instagram Business or Creator account linked to a Facebook Page."
            : "Connect a Facebook Page you manage."}
        </p>
        {canConnect ? (
          <Button variant={connected ? "outline" : "default"} size="sm" onClick={connect}>
            {connected ? "Reconnect" : "Connect"}
            <ExternalLink className="ml-1 h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        ) : (
          <p className="text-xs text-muted-foreground">
            Meta OAuth is not configured. Set <code>NEXT_PUBLIC_META_APP_ID</code> and{" "}
            <code>META_OAUTH_REDIRECT_URI</code>.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
