"use client";

/**
 * Lightweight shadcn-style chart wrapper around recharts.
 *
 * Exports:
 *  - <ChartContainer config={...}> wraps a recharts <ResponsiveContainer>
 *    and pushes CSS variables for series colors derived from `config`.
 *  - <ChartTooltip /> and <ChartTooltipContent /> are theme-aware tooltip
 *    primitives intended for use with recharts' <Tooltip content={...}>.
 *  - <ChartLegend /> and <ChartLegendContent /> similarly for legends.
 *
 * Kept intentionally small — the public shadcn chart.tsx pulls in extras
 * (payload helpers, axis variants) we don't need here.
 */

import * as React from "react";
import {
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  Legend as RechartsLegend,
} from "recharts";
import { cn } from "@/lib/utils";

export interface ChartConfig {
  [seriesKey: string]: {
    label: string;
    color?: string;
  };
}

const ChartContext = React.createContext<{ config: ChartConfig } | null>(null);

function useChart() {
  const ctx = React.useContext(ChartContext);
  if (!ctx) throw new Error("Chart subcomponents must be used within <ChartContainer>");
  return ctx;
}

export function ChartContainer({
  config,
  className,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  config: ChartConfig;
  children: React.ReactElement;
}) {
  const cssVars: React.CSSProperties = {};
  Object.entries(config).forEach(([key, val], idx) => {
    const color = val.color ?? defaultColor(idx);
    (cssVars as Record<string, string>)[`--color-${key}`] = color;
  });

  return (
    <ChartContext.Provider value={{ config }}>
      <div
        data-slot="chart"
        className={cn(
          "flex aspect-video w-full justify-center text-xs [&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground [&_.recharts-cartesian-grid_line]:stroke-border/40 [&_.recharts-tooltip-cursor]:stroke-border",
          className,
        )}
        style={cssVars}
        {...props}
      >
        <ResponsiveContainer width="100%" height="100%">
          {children}
        </ResponsiveContainer>
      </div>
    </ChartContext.Provider>
  );
}

function defaultColor(idx: number): string {
  // Tailwind-ish chart palette — readable on light + dark.
  const palette = [
    "hsl(221 83% 53%)",
    "hsl(142 71% 45%)",
    "hsl(45 93% 47%)",
    "hsl(0 84% 60%)",
    "hsl(280 65% 60%)",
    "hsl(199 89% 48%)",
    "hsl(24 95% 53%)",
  ];
  return palette[idx % palette.length]!;
}

// ---- Tooltip --------------------------------------------------------------

export const ChartTooltip = RechartsTooltip;

interface ChartTooltipContentProps {
  active?: boolean;
  payload?: Array<{
    name?: string;
    value?: number | string;
    dataKey?: string;
    color?: string;
    payload?: Record<string, unknown>;
  }>;
  label?: string | number;
  labelFormatter?: (label: unknown) => React.ReactNode;
  valueFormatter?: (val: number | string | undefined) => React.ReactNode;
  hideLabel?: boolean;
}

export function ChartTooltipContent({
  active,
  payload,
  label,
  labelFormatter,
  valueFormatter,
  hideLabel,
}: ChartTooltipContentProps) {
  const { config } = useChart();
  if (!active || !payload?.length) return null;
  return (
    <div className="grid min-w-[8rem] gap-1 rounded-md border bg-popover px-3 py-2 text-xs shadow-md">
      {!hideLabel && label !== undefined && (
        <div className="font-medium text-popover-foreground">
          {labelFormatter ? labelFormatter(label) : String(label)}
        </div>
      )}
      <div className="grid gap-1">
        {payload.map((item, i) => {
          const key = item.dataKey ?? item.name ?? String(i);
          const seriesLabel = (key && config[key]?.label) || item.name || key;
          return (
            <div key={i} className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span
                  className="inline-block h-2 w-2 rounded-[2px]"
                  style={{ backgroundColor: item.color ?? `var(--color-${key})` }}
                />
                <span className="text-muted-foreground">{seriesLabel}</span>
              </div>
              <span className="font-mono text-foreground tabular-nums">
                {valueFormatter ? valueFormatter(item.value) : item.value}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---- Legend ---------------------------------------------------------------

export const ChartLegend = RechartsLegend;

interface ChartLegendContentProps {
  payload?: Array<{ value?: string; color?: string; dataKey?: string }>;
}

export function ChartLegendContent({ payload }: ChartLegendContentProps) {
  const { config } = useChart();
  if (!payload?.length) return null;
  return (
    <div className="flex flex-wrap items-center justify-center gap-3 pt-2 text-xs">
      {payload.map((item, i) => {
        const key = item.dataKey ?? item.value ?? String(i);
        const seriesLabel = (key && config[key]?.label) || item.value || key;
        return (
          <div key={i} className="flex items-center gap-1.5">
            <span
              className="inline-block h-2 w-2 rounded-[2px]"
              style={{ backgroundColor: item.color ?? `var(--color-${key})` }}
            />
            <span className="text-muted-foreground">{seriesLabel}</span>
          </div>
        );
      })}
    </div>
  );
}
