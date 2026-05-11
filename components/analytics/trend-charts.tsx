"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";
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
import { channelValues, type Channel } from "@/lib/db/enums";

interface TrendPoint {
  date: string;
  [k: string]: number | string;
}

export function TrendCharts({
  reach,
  engagement,
  followers,
  split,
}: {
  reach: TrendPoint[];
  engagement: TrendPoint[];
  followers: TrendPoint[];
  split: "all" | "channel";
}) {
  const reachConfig: ChartConfig =
    split === "channel"
      ? Object.fromEntries(
          channelValues.map((c, i) => [c, { label: cap(c), color: palette(i) }]),
        )
      : { reach: { label: "Reach", color: "hsl(221 83% 53%)" } };

  const erConfig: ChartConfig = {
    er: { label: "Engagement rate", color: "hsl(142 71% 45%)" },
  };
  const followersConfig: ChartConfig = {
    followers: { label: "Followers", color: "hsl(280 65% 60%)" },
  };

  // For ER reference line: brand average over the window.
  const erValues = engagement.map((p) => (p.er as number) ?? 0);
  const erAvg =
    erValues.length === 0 ? 0 : erValues.reduce((a, b) => a + b, 0) / erValues.length;

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Reach over time</CardTitle>
          <CardDescription>
            {split === "channel" ? "Stacked by channel" : "Single area"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ChartContainer config={reachConfig} className="h-48">
            <AreaChart data={reach} margin={{ left: 0, right: 8, top: 8 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="date" tickLine={false} axisLine={false} fontSize={10} />
              <YAxis tickLine={false} axisLine={false} fontSize={10} width={36} />
              <ChartTooltip content={<ChartTooltipContent />} />
              {split === "channel"
                ? channelValues.map((c: Channel) => (
                    <Area
                      key={c}
                      dataKey={c}
                      stackId="reach"
                      type="monotone"
                      stroke={`var(--color-${c})`}
                      fill={`var(--color-${c})`}
                      fillOpacity={0.2}
                    />
                  ))
                : (
                    <Area
                      dataKey="reach"
                      type="monotone"
                      stroke="var(--color-reach)"
                      fill="var(--color-reach)"
                      fillOpacity={0.2}
                    />
                  )}
            </AreaChart>
          </ChartContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Engagement rate</CardTitle>
          <CardDescription>
            Dotted line = brand avg ({(erAvg * 100).toFixed(1)}%)
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ChartContainer config={erConfig} className="h-48">
            <LineChart data={engagement} margin={{ left: 0, right: 8, top: 8 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="date" tickLine={false} axisLine={false} fontSize={10} />
              <YAxis
                tickLine={false}
                axisLine={false}
                fontSize={10}
                width={36}
                tickFormatter={(v) => `${(Number(v) * 100).toFixed(0)}%`}
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    valueFormatter={(v) =>
                      typeof v === "number" ? `${(v * 100).toFixed(2)}%` : "—"
                    }
                  />
                }
              />
              <ReferenceLine y={erAvg} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" />
              <Line
                dataKey="er"
                type="monotone"
                stroke="var(--color-er)"
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ChartContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Follower growth</CardTitle>
          <CardDescription>Cumulative follower count over time</CardDescription>
        </CardHeader>
        <CardContent>
          <ChartContainer config={followersConfig} className="h-48">
            <LineChart data={followers} margin={{ left: 0, right: 8, top: 8 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="date" tickLine={false} axisLine={false} fontSize={10} />
              <YAxis tickLine={false} axisLine={false} fontSize={10} width={42} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Line
                dataKey="followers"
                type="monotone"
                stroke="var(--color-followers)"
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ChartContainer>
        </CardContent>
      </Card>
    </div>
  );
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function palette(i: number): string {
  const p = [
    "hsl(221 83% 53%)",
    "hsl(142 71% 45%)",
    "hsl(45 93% 47%)",
    "hsl(0 84% 60%)",
    "hsl(280 65% 60%)",
    "hsl(199 89% 48%)",
    "hsl(24 95% 53%)",
  ];
  return p[i % p.length]!;
}
