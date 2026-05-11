"use client";

import { useQuery } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { useBrandStore } from "@/lib/stores/brand-store";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { AlertList, type SystemAlertDTO } from "@/components/alerts/alert-list";

interface AlertBadgeProps {
  collapsed?: boolean;
}

async function fetchAlerts(brandId: string | undefined): Promise<SystemAlertDTO[]> {
  const url = brandId
    ? `/api/alerts?brandId=${encodeURIComponent(brandId)}`
    : `/api/alerts?scope=all`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = (await res.json()) as { alerts: SystemAlertDTO[] };
  return json.alerts;
}

export function AlertBadge({ collapsed = false }: AlertBadgeProps) {
  const active = useBrandStore((s) => s.active);
  const brandId = active?.id;
  const looksLikeUuid =
    typeof brandId === "string" && /^[0-9a-f-]{36}$/i.test(brandId);

  const { data, isLoading } = useQuery({
    queryKey: ["alerts", brandId ?? "all"],
    queryFn: () => fetchAlerts(looksLikeUuid ? brandId : undefined),
    refetchInterval: 60_000,
    staleTime: 30_000,
    retry: 1,
  });

  const count = data?.length ?? 0;
  const label = count > 0 ? `${count} alert${count === 1 ? "" : "s"}` : "No alerts";

  const trigger = (
    <Button
      variant="ghost"
      size="sm"
      className={cn(
        "relative w-full justify-start gap-3 px-3 py-2 text-sm",
        collapsed && "justify-center px-2",
      )}
      aria-label={label}
    >
      <span className="relative inline-flex">
        <Bell className="h-4 w-4 shrink-0" aria-hidden="true" />
        {count > 0 && (
          <span
            className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground"
            aria-hidden="true"
          >
            {count > 9 ? "9+" : count}
          </span>
        )}
      </span>
      {!collapsed && <span className="truncate">Alerts</span>}
      {!collapsed && count > 0 && (
        <span className="ml-auto text-xs text-muted-foreground">{count}</span>
      )}
    </Button>
  );

  return (
    <Sheet>
      <SheetTrigger asChild>
        {collapsed ? (
          <Tooltip>
            <TooltipTrigger asChild>{trigger}</TooltipTrigger>
            <TooltipContent side="right">{label}</TooltipContent>
          </Tooltip>
        ) : (
          trigger
        )}
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>System alerts</SheetTitle>
          <SheetDescription>
            Failed jobs, expired channel connections, and posts that exhausted retries.
          </SheetDescription>
        </SheetHeader>
        <div className="mt-4">
          <AlertList alerts={data ?? []} loading={isLoading} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
