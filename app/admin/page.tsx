"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ConnectionStatus } from "@/lib/connections/check";

const CHANNEL_LABEL: Record<string, string> = { instagram: "Instagram", facebook: "Facebook" };
const STATUS_LABEL: Record<ConnectionStatus["status"], string> = { connected: "Active", expired: "Expired", revoked: "Revoked", error: "Error" };

async function load(method: "GET" | "POST"): Promise<ConnectionStatus[]> {
  const res = await fetch("/api/admin/connections", { method, cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return ((await res.json()) as { connections: ConnectionStatus[] }).connections;
}

export default function AdminPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["admin-connections"], queryFn: () => load("GET"), refetchInterval: 60_000 });
  const check = useMutation({
    mutationFn: () => load("POST"),
    onSuccess: (rows) => { qc.setQueryData(["admin-connections"], rows); toast.success("Connections checked"); },
    onError: (e) => toast.error((e as Error).message),
  });

  const byBrand = new Map<string, ConnectionStatus[]>();
  for (const c of data ?? []) byBrand.set(c.brandName, [...(byBrand.get(c.brandName) ?? []), c]);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Admin</h1>
          <p className="text-sm text-muted-foreground">Account connections are checked against Meta every hour.</p>
        </div>
        <Button variant="outline" onClick={() => check.mutate()} disabled={check.isPending}>
          <RefreshCw className={`mr-2 h-4 w-4 ${check.isPending ? "animate-spin" : ""}`} aria-hidden="true" />
          Check now
        </Button>
      </header>

      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {!isLoading && byBrand.size === 0 && (
        <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">No Instagram or Facebook accounts are connected yet.</CardContent></Card>
      )}

      {[...byBrand.entries()].map(([brand, rows]) => (
        <Card key={brand}>
          <CardHeader className="pb-2"><CardTitle className="text-base">{brand}</CardTitle></CardHeader>
          <CardContent className="flex flex-col divide-y">
            {rows.sort((a, b) => b.channel.localeCompare(a.channel)).map((c) => (
              <div key={c.id} className="flex items-center justify-between gap-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{CHANNEL_LABEL[c.channel] ?? c.channel}</p>
                  <p className="truncate text-sm text-muted-foreground">
                    {c.accountName ?? "Account not checked yet"}
                    {c.lastCheckedAt ? ` · checked ${new Date(c.lastCheckedAt).toLocaleString()}` : ""}
                  </p>
                  {c.lastCheckError && <p className="text-sm text-destructive">{c.lastCheckError}</p>}
                </div>
                <Badge variant={c.status === "connected" && !c.lastCheckError ? "default" : "destructive"} className={c.status === "connected" && !c.lastCheckError ? "bg-emerald-600 hover:bg-emerald-600" : undefined}>
                  {c.status === "connected" && c.lastCheckError ? "Check failed" : STATUS_LABEL[c.status]}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
