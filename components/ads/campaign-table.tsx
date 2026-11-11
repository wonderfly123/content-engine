"use client";

import { Megaphone } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { cn } from "@/lib/utils";
import { formatCount, formatCurrency, formatPercent } from "./format";

export interface AdCampaignRow {
  id: string;
  name: string;
  status: string | null;
  effectiveStatus: string | null;
  objective: string | null;
  dailyBudget: number | null;
  lifetimeBudget: number | null;
  spend: number;
  impressions: number;
  clicks: number;
  /** Fraction (0-1). */
  ctr: number;
  cpc: number;
}

export function CampaignTable({
  rows,
  loading,
}: {
  rows: AdCampaignRow[];
  loading?: boolean;
}) {
  if (!loading && rows.length === 0) {
    return (
      <EmptyState
        icon={Megaphone}
        title="No ad data yet"
        description="Connect an ad account and the daily ingest will populate this page."
      />
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Campaigns</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead className="w-[110px]">Status</TableHead>
              <TableHead>Objective</TableHead>
              <TableHead>Budget</TableHead>
              <TableHead className="text-right">Spend</TableHead>
              <TableHead className="text-right">Impr.</TableHead>
              <TableHead className="text-right">CTR</TableHead>
              <TableHead className="text-right">CPC</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading
              ? Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 8 }).map((__, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-4 w-full" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              : rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="max-w-[280px] truncate font-medium">
                      {r.name || "Untitled campaign"}
                    </TableCell>
                    <TableCell>
                      <StatusBadge
                        status={r.effectiveStatus ?? r.status}
                      />
                    </TableCell>
                    <TableCell className="capitalize">
                      {formatObjective(r.objective)}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {formatBudget(r.dailyBudget, r.lifetimeBudget)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCurrency(r.spend)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCount(r.impressions)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatPercent(r.ctr)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCurrency(r.cpc)}
                    </TableCell>
                  </TableRow>
                ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: string | null }) {
  if (!status) {
    return <span className="text-sm text-muted-foreground">—</span>;
  }
  const label = status.replace(/_/g, " ").toLowerCase();
  const cls =
    status === "ACTIVE"
      ? "border-transparent bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400"
      : status === "PAUSED" || status === "CAMPAIGN_PAUSED"
        ? "border-transparent bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400"
        : undefined;
  return (
    <Badge variant={cls ? "outline" : "secondary"} className={cn("capitalize", cls)}>
      {label}
    </Badge>
  );
}

function formatObjective(objective: string | null): string {
  if (!objective) return "—";
  return objective.replace(/^OUTCOME_/, "").replace(/_/g, " ").toLowerCase();
}

function formatBudget(
  daily: number | null,
  lifetime: number | null,
): string {
  if (daily != null) return `${formatCurrency(daily)}/day`;
  if (lifetime != null) return `${formatCurrency(lifetime)} lifetime`;
  return "—";
}
