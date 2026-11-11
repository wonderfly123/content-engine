"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, PlugZap, RotateCw, XCircle } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import type { SystemAlertDTO } from "@/components/alerts/alert-list";

const MAX_ALERTS = 4;

async function fetchAlerts(brandId: string): Promise<SystemAlertDTO[]> {
  const res = await fetch(
    `/api/alerts?brandId=${encodeURIComponent(brandId)}`,
    { cache: "no-store" },
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = (await res.json()) as { alerts: SystemAlertDTO[] };
  return json.alerts;
}

function iconFor(kind: SystemAlertDTO["kind"]) {
  switch (kind) {
    case "job_failed":
      return RotateCw;
    case "channel_disconnected":
      return PlugZap;
    case "post_failed":
      return XCircle;
    default:
      return AlertTriangle;
  }
}

function hrefFor(kind: SystemAlertDTO["kind"]): string | null {
  switch (kind) {
    case "channel_disconnected":
      return "/admin";
    case "post_failed":
      return "/calendar";
    default:
      return null;
  }
}

export function AlertsCard({ brandId }: { brandId: string }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["alerts", brandId],
    queryFn: () => fetchAlerts(brandId),
    refetchInterval: 60_000,
    staleTime: 30_000,
    retry: 1,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Alerts</CardTitle>
        <CardDescription>
          Failed publishes, expired tokens, failed jobs
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 2 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : isError || !data ? (
          <p className="text-sm text-muted-foreground">
            Couldn&apos;t load alerts.
          </p>
        ) : data.length === 0 ? (
          <p className="text-sm text-muted-foreground">All clear.</p>
        ) : (
          <ul className="divide-y" role="list">
            {data.slice(0, MAX_ALERTS).map((a) => {
              const Icon = iconFor(a.kind);
              const href = hrefFor(a.kind);
              const body = (
                <div className="flex items-start gap-3 py-2">
                  <Icon
                    className="mt-0.5 h-4 w-4 shrink-0 text-destructive"
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-medium">{a.title}</p>
                      {a.channel && (
                        <Badge variant="secondary" className="capitalize">
                          {a.channel}
                        </Badge>
                      )}
                    </div>
                    <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                      {a.detail}
                    </p>
                  </div>
                </div>
              );
              return (
                <li key={a.id}>
                  {href ? (
                    <Link href={href} className="block hover:bg-accent/50">
                      {body}
                    </Link>
                  ) : (
                    body
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {!isLoading && !isError && data && data.length > MAX_ALERTS && (
          <p className="mt-2 text-xs text-muted-foreground">
            +{data.length - MAX_ALERTS} more in the alerts panel.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
