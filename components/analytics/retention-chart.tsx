"use client";

import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

interface SnapshotShape {
  pulledAt: string;
  watchTimeSec: number | null;
  videoViews: number | null;
}

/**
 * Reels-only retention chart. We treat watch_time / video_views per snapshot
 * as the "average view duration" series. If raw_json contains a richer
 * retention curve in future, swap it in.
 */
export function RetentionChart({ snapshots }: { snapshots: SnapshotShape[] }) {
  const data = snapshots
    .filter((s) => s.videoViews && s.videoViews > 0 && s.watchTimeSec != null)
    .map((s) => ({
      date: s.pulledAt.slice(0, 10),
      avgWatchSec: (s.watchTimeSec ?? 0) / (s.videoViews ?? 1),
    }));

  if (data.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Retention</CardTitle>
          <CardDescription>No retention data yet.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const config: ChartConfig = {
    avgWatchSec: { label: "Avg watch (s)", color: "hsl(199 89% 48%)" },
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Retention</CardTitle>
        <CardDescription>Average watch duration per snapshot</CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={config} className="h-48">
          <LineChart data={data} margin={{ left: 0, right: 8, top: 8 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="date" tickLine={false} axisLine={false} fontSize={10} />
            <YAxis tickLine={false} axisLine={false} fontSize={10} width={36} />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Line
              dataKey="avgWatchSec"
              type="monotone"
              stroke="var(--color-avgWatchSec)"
              strokeWidth={2}
              dot={false}
            />
          </LineChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
