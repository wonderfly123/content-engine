"use client";

import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
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
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency } from "./format";

export interface AdsDailyPoint {
  /** YYYY-MM-DD */
  day: string;
  spend: number;
  impressions: number;
  clicks: number;
}

const spendConfig: ChartConfig = {
  spend: { label: "Spend", color: "hsl(221 83% 53%)" },
};

export function SpendTrend({
  daily,
  days,
  loading,
}: {
  daily?: AdsDailyPoint[];
  days: number;
  loading?: boolean;
}) {
  const data = (daily ?? []).map((d) => ({
    ...d,
    date: new Date(`${d.day}T00:00:00`).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    }),
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Daily spend</CardTitle>
        <CardDescription>
          Ad spend per day over the last {days} days
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-56 w-full" />
        ) : (
          <ChartContainer config={spendConfig} className="h-56 w-full">
            <AreaChart data={data} margin={{ left: 0, right: 8, top: 8 }}>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="date"
                tickLine={false}
                axisLine={false}
                fontSize={10}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                fontSize={10}
                width={48}
                tickFormatter={(v) => formatCurrency(Number(v))}
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    valueFormatter={(v) =>
                      typeof v === "number" ? formatCurrency(v) : "—"
                    }
                  />
                }
              />
              <Area
                dataKey="spend"
                type="monotone"
                stroke="var(--color-spend)"
                fill="var(--color-spend)"
                fillOpacity={0.2}
              />
            </AreaChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}
