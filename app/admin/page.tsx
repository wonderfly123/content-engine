"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ConnectionStatus } from "@/lib/connections/check";
import type { AdminBrand } from "@/app/api/admin/connections/route";

const CHANNEL_LABEL: Record<string, string> = { instagram: "Instagram", facebook: "Facebook" };
const STATUS_LABEL: Record<ConnectionStatus["status"], string> = { connected: "Active", expired: "Expired", revoked: "Revoked", error: "Error" };

interface Loaded {
  connections: ConnectionStatus[];
  brands: AdminBrand[];
}

async function load(method: "GET" | "POST"): Promise<Loaded> {
  const res = await fetch("/api/admin/connections", { method, cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as Loaded;
}

/** Admin: the Instagram and Facebook accounts the app posts to, checked against Meta every hour. */
export default function AdminConnectionsPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["admin-connections"], queryFn: () => load("GET"), refetchInterval: 60_000 });
  const check = useMutation({
    mutationFn: () => load("POST"),
    onSuccess: (loaded) => { qc.setQueryData(["admin-connections"], loaded); toast.success("Connections checked"); },
    onError: (e) => toast.error((e as Error).message),
  });

  // Every brand, connected or not, keyed by id (two workspaces may use the same brand name).
  const byBrand = new Map<string, { name: string; rows: ConnectionStatus[] }>();
  for (const b of data?.brands ?? []) byBrand.set(b.id, { name: b.name, rows: [] });
  for (const c of data?.connections ?? []) {
    const entry = byBrand.get(c.brandId) ?? { name: c.brandName, rows: [] };
    entry.rows.push(c);
    byBrand.set(c.brandId, entry);
  }

  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Connections across all brands</h2>
          <p className="text-sm text-muted-foreground">The Instagram and Facebook accounts the app posts to. They&apos;re checked against Meta every hour.</p>
        </div>
        <Button variant="outline" onClick={() => check.mutate()} disabled={check.isPending}>
          <RefreshCw className={`mr-2 h-4 w-4 ${check.isPending ? "animate-spin" : ""}`} aria-hidden="true" />
          Check now
        </Button>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {!isLoading && byBrand.size === 0 && (
        <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">No brands yet.</CardContent></Card>
      )}

      {[...byBrand.entries()].map(([id, { name, rows }]) => (
        <Card key={id}>
          <CardHeader className="pb-2"><CardTitle className="text-base">{name}</CardTitle></CardHeader>
          <CardContent className="flex flex-col divide-y">
            {rows.length === 0 && (
              <div className="flex items-center justify-between gap-4 py-3">
                <p className="text-sm text-muted-foreground">
                  Nothing connected.{" "}
                  <Link href={`/settings?tab=integrations&brandId=${id}`} className="underline underline-offset-4">Connect in Settings › Integrations</Link>
                  {" "}(works for brands in your own workspace).
                </p>
                <Badge variant="outline">Not connected</Badge>
              </div>
            )}
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
