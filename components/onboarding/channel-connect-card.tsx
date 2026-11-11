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

  const buildAuthUrl = (): string | null => {
    if (!appId || !redirectUri) return null;
    const state = `${brandId}|${crypto.randomUUID()}`;
    const url = new URL("https://www.facebook.com/v21.0/dialog/oauth");
    url.searchParams.set("client_id", appId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("state", state);
    url.searchParams.set("scope", SCOPES.join(","));
    url.searchParams.set("response_type", "code");
    return url.toString();
  };

  const authUrl = buildAuthUrl();

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
        {authUrl ? (
          <Button asChild variant={connected ? "outline" : "default"} size="sm">
            <a href={authUrl}>
              {connected ? "Reconnect" : "Connect"}
              <ExternalLink className="ml-1 h-3.5 w-3.5" aria-hidden="true" />
            </a>
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
