import Link from "next/link";
import { ExternalLink, MessageSquareText } from "lucide-react";
import { ChannelConnectCard } from "@/components/onboarding/channel-connect-card";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FinishButton } from "./finish-button";

interface ExtrasProps {
  brandId: string;
  instagramConnected: boolean;
  justConnected: boolean;
  appId?: string;
  redirectUri?: string;
}

/**
 * Step 6, all optional: connect Instagram (the existing Meta sign-in; when it is not set up for this
 * site the card says so and the step can still be skipped) and add a phone for texting the editor.
 */
export function Extras({ brandId, instagramConnected, justConnected, appId, redirectUri }: ExtrasProps) {
  return (
    <div className="space-y-4">
      <header>
        <h2 className="text-xl font-semibold">Two optional extras</h2>
        <p className="text-sm text-muted-foreground">Both can wait. You&apos;ll find them in Settings any time.</p>
      </header>
      {justConnected && instagramConnected && <p className="text-sm text-green-700">Instagram is connected.</p>}
      <div className="grid gap-4 sm:grid-cols-2">
        <ChannelConnectCard channel="instagram" brandId={brandId} connected={instagramConnected} appId={appId} redirectUri={redirectUri} />
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <MessageSquareText className="h-5 w-5" aria-hidden="true" />
              Text the editor
            </CardTitle>
            <CardDescription>Add your mobile number to send clips and get cuts back by text.</CardDescription>
          </CardHeader>
          <CardContent>
            <Link href={`/settings?${new URLSearchParams({ brandId: brandId ?? "", tab: "app" })}`} target="_blank" className="inline-flex items-center gap-1 text-sm font-medium underline-offset-4 hover:underline">
              Set up texting in Settings
              <ExternalLink className="h-3 w-3" aria-hidden="true" />
            </Link>
          </CardContent>
        </Card>
      </div>
      <div className="flex justify-end gap-2">
        <FinishButton brandId={brandId} label={instagramConnected ? "Continue" : "Skip for now"} />
      </div>
    </div>
  );
}
