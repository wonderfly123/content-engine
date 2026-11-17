"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, MessageSquareText } from "lucide-react";
import { toast } from "sonner";
import { confirmPhone, removePhone, setBrandTexting, startPhoneVerification } from "@/app/settings/phone-actions";
import { SITE } from "@/lib/site";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface PhoneCardProps {
  brandId: string;
  brandName: string;
  /** Null when the caller has no number yet. */
  status: { phone: string; verified: boolean; codePending: boolean } | null;
  textingEnabled: boolean;
  /** The caller's confirmed number texts for this brand. */
  onForBrand: boolean;
}

/**
 * Texting the editor for one brand (Settings > Channels). The caller's mobile number is confirmed
 * once with a 6-digit code by text, then turned on brand by brand; texts only reach brands it is on for.
 */
export function PhoneCard({ brandId, brandName, status, textingEnabled, onForBrand }: PhoneCardProps) {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [consent, setConsent] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const awaitingCode = Boolean(status && !status.verified && status.codePending);

  const run = (action: () => Promise<{ ok: true } | { ok: false; error: string }>, done: string) =>
    start(async () => {
      setError(null);
      const res = await action();
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setPhone("");
      setCode("");
      toast.success(done);
      router.refresh();
    });

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <MessageSquareText className="h-4 w-4" aria-hidden="true" />
            Text the editor
          </CardTitle>
          <CardDescription>
            Start {brandName} reels and stories by text. Your number only reaches the brands you turn it on for; your
            texts and the app share the same conversations.
          </CardDescription>
        </div>
        {status?.verified && onForBrand ? (
          <Badge className="shrink-0">
            <Check className="mr-1 h-3 w-3" aria-hidden="true" />
            On for this brand
          </Badge>
        ) : (
          <Badge variant="outline" className="shrink-0">
            {status?.verified ? "Off for this brand" : awaitingCode ? "Waiting for code" : "Not added"}
          </Badge>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {!textingEnabled && (
          <p className="rounded-md border border-dashed bg-muted/30 p-3 text-sm text-muted-foreground">
            Texting isn&apos;t switched on yet. Once it is, you can add your number here and get a code to confirm it.
          </p>
        )}

        {status && (
          <div className="flex items-center justify-between gap-2 text-sm">
            <span>
              <span className="font-mono">{status.phone}</span>
              <span className="ml-2 text-muted-foreground">{status.verified ? "confirmed" : "not confirmed yet"}</span>
            </span>
            <Button variant="outline" size="sm" disabled={pending} onClick={() => run(() => removePhone(), "Number removed from every brand.")}>
              Remove number
            </Button>
          </div>
        )}

        {status?.verified && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/30 p-3 text-sm">
            <span className="text-muted-foreground">
              {onForBrand ? `Texts from this number can start ${brandName} videos.` : `Texts from this number don't reach ${brandName}.`}
            </span>
            <Button
              size="sm"
              variant={onForBrand ? "outline" : "default"}
              disabled={pending}
              onClick={() =>
                run(() => setBrandTexting({ brandId, on: !onForBrand }), onForBrand ? `Texting off for ${brandName}.` : `Texting on for ${brandName}.`)
              }
            >
              {onForBrand ? "Turn off for this brand" : "Turn on for this brand"}
            </Button>
          </div>
        )}

        {awaitingCode && (
          <div className="space-y-2">
            <Label htmlFor="phone-code">Code we texted you</Label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id="phone-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="6-digit code"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                disabled={pending}
              />
              <Button className="shrink-0" disabled={pending || code.trim().length < 6} onClick={() => run(() => confirmPhone({ code, brandId }), `Number confirmed and on for ${brandName}.`)}>
                Confirm
              </Button>
            </div>
          </div>
        )}

        {!status?.verified && (
          <div className="space-y-2">
            <Label htmlFor="phone-number">{status ? "Send a new code to" : "Mobile number"}</Label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id="phone-number"
                type="tel"
                autoComplete="tel"
                placeholder={status?.phone ?? "(619) 555-0123"}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                disabled={pending || !textingEnabled}
              />
              <Button
                className="shrink-0"
                disabled={pending || !textingEnabled || !consent || (phone.trim() || status?.phone || "").length < 7}
                onClick={() => run(() => startPhoneVerification({ phone: phone.trim() || status?.phone || "", consent: true }), "Code sent.")}
              >
                {pending ? "Sending..." : "Send code"}
              </Button>
            </div>
            <label className="flex items-start gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                className="mt-1"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                disabled={pending || !textingEnabled}
              />
              <span>
                I agree to receive texts from {SITE.textingProgram} about my videos: replies, preview links and post
                confirmations. Message frequency varies. Message and data rates may apply. Reply STOP to cancel, HELP for
                help. Not required to use {SITE.productName}. See the{" "}
                <a href="/texting" target="_blank" rel="noreferrer" className="underline underline-offset-4">texting terms</a> and{" "}
                <a href="/privacy" target="_blank" rel="noreferrer" className="underline underline-offset-4">privacy policy</a>.
              </span>
            </label>
          </div>
        )}

        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
