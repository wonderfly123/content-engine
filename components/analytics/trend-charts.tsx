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
  views,
  engagement,
  newFollowers,
}: {
  /** Views by the day each post was published. */
  views: TrendPoint[];
  engagement: TrendPoint[];
  /** New followers per day (Instagram keeps 30 days). */
  newFollowers: TrendPoint[];
}) {
  const split = "all" as "all" | "channel";
  const reach = views;
  const followers = newFollowers;
  const reachConfig: ChartConfig =
    split === "channel"
      ? Object.fromEntries(
          channelValues.map((c, i) => [c, { label: cap(c), color: palette(i) }]),
        )
      : { views: { label: "Views", color: "hsl(221 83% 53%)" } };

  const erConfig: ChartConfig = {
    er: { label: "Engagement rate", color: "hsl(142 71% 45%)" },
  };
  const followersConfig: ChartConfig = {
    newFollowers: { label: "New followers", color: "hsl(280 65% 60%)" },
  };

  // For ER reference line: brand average over the window.
  const erValues = engagement.map((p) => (p.er as number) ?? 0);
  const erAvg =
    erValues.length === 0 ? 0 : erValues.reduce((a, b) => a + b, 0) / erValues.length;

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Views by post</CardTitle>
          <CardDescription>Placed on the day each post went up</CardDescription>
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
                      dataKey="views"
                      type="monotone"
                      stroke="var(--color-views)"
                      fill="var(--color-views)"
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
            Interactions per view · average ({(erAvg * 100).toFixed(1)}%)
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
                // With no engagement yet the auto scale ran 0 to 400%; keep at least a 0 to 10% range.
                domain={[0, (max: number) => Math.max(0.1, Math.ceil(max * 20) / 20)]}
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
          <CardTitle className="text-base">New followers per day</CardTitle>
          <CardDescription>Last 30 days at most; Instagram keeps no more</CardDescription>
        </CardHeader>
        <CardContent>
          <ChartContainer config={followersConfig} className="h-48">
            <LineChart data={followers} margin={{ left: 0, right: 8, top: 8 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="date" tickLine={false} axisLine={false} fontSize={10} />
              <YAxis tickLine={false} axisLine={false} fontSize={10} width={42} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Line
                dataKey="newFollowers"
                type="monotone"
                stroke="var(--color-newFollowers)"
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
