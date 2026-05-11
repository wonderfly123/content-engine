"use client";

import { AlertTriangle, PlugZap, RotateCw, XCircle } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";

export interface SystemAlertDTO {
  id: string;
  kind: "job_failed" | "channel_disconnected" | "post_failed";
  brandId: string | null;
  title: string;
  detail: string;
  entityId: string;
  channel?: string;
  at: string;
}

interface AlertListProps {
  alerts: SystemAlertDTO[];
  loading?: boolean;
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

export function AlertList({ alerts, loading }: AlertListProps) {
  if (loading) {
    return (
      <p className="text-sm text-muted-foreground" aria-busy="true">
        Loading alerts…
      </p>
    );
  }
  if (alerts.length === 0) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title="No alerts"
        description="The system has nothing to flag right now."
      />
    );
  }
  return (
    <ul className="divide-y" role="list">
      {alerts.map((a) => {
        const Icon = iconFor(a.kind);
        return (
          <li key={a.id} className="flex items-start gap-3 py-3">
            <Icon className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium truncate">{a.title}</p>
                {a.channel && (
                  <Badge variant="secondary" className="capitalize">
                    {a.channel}
                  </Badge>
                )}
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">
                {a.detail}
              </p>
              <p className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground/70">
                {new Date(a.at).toLocaleString()}
              </p>
              <div className="mt-2">
                <AlertAction alert={a} />
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function AlertAction({ alert }: { alert: SystemAlertDTO }) {
  switch (alert.kind) {
    case "channel_disconnected":
      return (
        <Button asChild size="sm" variant="outline">
          <Link href="/settings?tab=channels" aria-label="Reconnect channel">
            Reconnect
          </Link>
        </Button>
      );
    case "post_failed":
      return (
        <Button asChild size="sm" variant="outline">
          <Link href="/calendar" aria-label="Review failed post">
            Review
          </Link>
        </Button>
      );
    case "job_failed":
    default:
      return (
        <span className="text-xs text-muted-foreground">
          Will retry automatically.
        </span>
      );
  }
}
