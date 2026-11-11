"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ConnectionStatus } from "@/lib/connections/check";
import type { AdminUser } from "@/app/api/admin/users/route";

const CHANNEL_LABEL: Record<string, string> = { instagram: "Instagram", facebook: "Facebook" };
const STATUS_LABEL: Record<ConnectionStatus["status"], string> = { connected: "Active", expired: "Expired", revoked: "Revoked", error: "Error" };

async function load(method: "GET" | "POST"): Promise<ConnectionStatus[]> {
  const res = await fetch("/api/admin/connections", { method, cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return ((await res.json()) as { connections: ConnectionStatus[] }).connections;
}

const USER_STATUS: Record<AdminUser["status"], string> = { pending: "Waiting for approval", active: "Active", disabled: "Disabled" };

async function usersRequest(body?: { id: string; action: string }): Promise<AdminUser[]> {
  const res = await fetch("/api/admin/users", body
    ? { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
    : { cache: "no-store" });
  const json = (await res.json().catch(() => ({}))) as { users?: AdminUser[]; error?: string };
  if (!res.ok || !json.users) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json.users;
}

function UsersCard() {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery({ queryKey: ["admin-users"], queryFn: () => usersRequest(), refetchInterval: 60_000 });
  const act = useMutation({
    mutationFn: (v: { id: string; action: string }) => usersRequest(v),
    onSuccess: (rows) => { qc.setQueryData(["admin-users"], rows); toast.success("Updated"); },
    onError: (e) => toast.error((e as Error).message),
  });
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">People</CardTitle>
        <p className="text-sm text-muted-foreground">New sign-ins wait here until you approve them. Changes can take up to an hour to reach someone already signed in.</p>
      </CardHeader>
      <CardContent className="flex flex-col divide-y">
        {isLoading && <p className="py-3 text-sm text-muted-foreground">Loading…</p>}
        {isError && <p className="py-3 text-sm text-muted-foreground">Sign in with Google to manage people.</p>}
        {data?.map((u) => (
          <div key={u.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{u.email}{u.isYou ? " (you)" : ""}</p>
              <p className="text-sm text-muted-foreground">
                {u.role === "admin" ? "Admin" : "Member"} · {USER_STATUS[u.status]}
                {u.lastSignInAt ? ` · last sign-in ${new Date(u.lastSignInAt).toLocaleDateString()}` : ""}
              </p>
            </div>
            <div className="flex gap-2">
              {u.status !== "active" && <Button size="sm" onClick={() => act.mutate({ id: u.id, action: "approve" })} disabled={act.isPending}>{u.status === "disabled" ? "Re-enable" : "Approve"}</Button>}
              {u.status === "active" && !u.isYou && u.role === "user" && <Button size="sm" variant="outline" onClick={() => act.mutate({ id: u.id, action: "make_admin" })} disabled={act.isPending}>Make admin</Button>}
              {u.status === "active" && !u.isYou && u.role === "admin" && <Button size="sm" variant="outline" onClick={() => act.mutate({ id: u.id, action: "make_user" })} disabled={act.isPending}>Remove admin</Button>}
              {u.status !== "disabled" && !u.isYou && <Button size="sm" variant="ghost" onClick={() => act.mutate({ id: u.id, action: "disable" })} disabled={act.isPending}>Disable</Button>}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
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
          <p className="text-sm text-muted-foreground">Who can use the app, and the accounts it posts to. Connections are checked against Meta every hour.</p>
        </div>
        <Button variant="outline" onClick={() => check.mutate()} disabled={check.isPending}>
          <RefreshCw className={`mr-2 h-4 w-4 ${check.isPending ? "animate-spin" : ""}`} aria-hidden="true" />
          Check now
        </Button>
      </header>

      <UsersCard />

      <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">Connections</h2>
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
