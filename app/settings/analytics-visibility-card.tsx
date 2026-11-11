"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { channelValues, type Channel } from "@/lib/db/enums";
import { setEnabledChannels } from "./actions";

interface AnalyticsVisibilityCardProps {
  brandId: string;
  /** Channels currently enabled for analytics (absent settings key = all). */
  initialEnabled: Channel[];
}

export function AnalyticsVisibilityCard({
  brandId,
  initialEnabled,
}: AnalyticsVisibilityCardProps) {
  const [enabled, setEnabled] = useState<Set<Channel>>(
    () => new Set(initialEnabled),
  );
  const [, startTransition] = useTransition();

  function toggle(channel: Channel, on: boolean) {
    const next = new Set(enabled);
    if (on) next.add(channel);
    else next.delete(channel);
    setEnabled(next);
    startTransition(async () => {
      const res = await setEnabledChannels({
        brandId,
        channels: Array.from(next),
      });
      if (!res.ok) {
        // Revert optimistic state on failure.
        setEnabled(new Set(enabled));
        toast.error(res.error);
      } else {
        toast.success("Analytics visibility saved.");
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Analytics visibility</CardTitle>
        <CardDescription>
          Toggle which channels appear in analytics. Disabled channels are
          excluded from all analytics numbers and filters so unused channels
          don&apos;t muddy the data.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y" role="list">
          {channelValues.map((c) => (
            <li
              key={c}
              className="flex items-center justify-between py-2 text-sm"
            >
              <label htmlFor={`analytics-channel-${c}`} className="capitalize">
                {c}
              </label>
              <Switch
                id={`analytics-channel-${c}`}
                checked={enabled.has(c)}
                onCheckedChange={(on) => toggle(c, on)}
                aria-label={`Show ${c} in analytics`}
              />
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
