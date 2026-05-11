import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { channelConnections } from "@/lib/db/schema";
import { Button } from "@/components/ui/button";
import { ChannelConnectCard } from "@/components/onboarding/channel-connect-card";
import type { Brand } from "../page";

interface Step7Props {
  brand: Brand;
}

export async function Step7Channels({ brand }: Step7Props) {
  const rows = await db
    .select({
      channel: channelConnections.channel,
      status: channelConnections.status,
    })
    .from(channelConnections)
    .where(eq(channelConnections.brandId, brand.id));
  const connected = new Set(
    rows.filter((r) => r.status === "connected").map((r) => r.channel),
  );

  const appId = process.env.NEXT_PUBLIC_META_APP_ID;
  const redirectUri = process.env.NEXT_PUBLIC_META_OAUTH_REDIRECT_URI;

  return (
    <div className="space-y-4">
      <header>
        <h2 className="text-xl font-semibold">Connect channels</h2>
        <p className="text-sm text-muted-foreground">
          We use one Meta connection for Instagram and Facebook. Skip for now if
          you&apos;d rather connect from Settings later.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        <ChannelConnectCard
          channel="instagram"
          brandId={brand.id}
          connected={connected.has("instagram")}
          appId={appId}
          redirectUri={redirectUri}
        />
        <ChannelConnectCard
          channel="facebook"
          brandId={brand.id}
          connected={connected.has("facebook")}
          appId={appId}
          redirectUri={redirectUri}
        />
      </div>

      <div className="flex justify-end gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link href={`/onboarding/${brand.id}?step=8`}>Skip</Link>
        </Button>
        <Button asChild>
          <Link href={`/onboarding/${brand.id}?step=8`}>Continue</Link>
        </Button>
      </div>
    </div>
  );
}
