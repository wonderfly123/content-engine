"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { AdminWorkspace } from "@/app/api/admin/workspaces/route";

type WorkspaceChange = { id: string; status: "active" | "disabled" } | { id: string; storageLimitGb: number | null };

async function workspacesRequest(body?: WorkspaceChange): Promise<AdminWorkspace[]> {
  const res = await fetch("/api/admin/workspaces", body
    ? { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
    : { cache: "no-store" });
  const json = (await res.json().catch(() => ({}))) as { workspaces?: AdminWorkspace[]; error?: string };
  if (!res.ok || !json.workspaces) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json.workspaces;
}

const gigabytes = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(2)} GB`;

/** Admin > Workspaces: every workspace on the platform. Only the platform admin sees this. */
export default function AdminWorkspacesPage() {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery({ queryKey: ["admin-workspaces"], queryFn: () => workspacesRequest(), refetchInterval: 60_000 });
  const act = useMutation({
    mutationFn: (v: WorkspaceChange) => workspacesRequest(v),
    onSuccess: (rows) => { qc.setQueryData(["admin-workspaces"], rows); toast.success("Updated"); },
    onError: (e) => toast.error((e as Error).message),
  });
  return (
    <Card className="max-w-4xl">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Workspaces</CardTitle>
        <p className="text-sm text-muted-foreground">Each account that signs up gets its own workspace. Disabling one locks its members out of its brands.</p>
      </CardHeader>
      <CardContent className="flex flex-col divide-y">
        {isLoading && <p className="py-3 text-sm text-muted-foreground">Loading…</p>}
        {isError && <p className="py-3 text-sm text-muted-foreground">Couldn&apos;t load workspaces.</p>}
        {data?.map((w) => (
          <div key={w.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{w.name}{w.isYours ? " (yours)" : ""}</p>
              <p className="truncate text-sm text-muted-foreground">
                {w.members.map((m) => `${m.email} (${m.role})`).join(", ") || "No members"}
              </p>
              <p className="text-sm text-muted-foreground">
                {w.brands} {w.brands === 1 ? "brand" : "brands"} · created {new Date(w.createdAt).toLocaleDateString()}
              </p>
              <StorageLimit workspace={w} saving={act.isPending} onSave={(gb) => act.mutate({ id: w.id, storageLimitGb: gb })} />
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={w.status === "active" ? "default" : "destructive"}>{w.status === "active" ? "Active" : "Disabled"}</Badge>
              {!w.isYours && (
                <Button size="sm" variant={w.status === "active" ? "ghost" : "outline"} onClick={() => act.mutate({ id: w.id, status: w.status === "active" ? "disabled" : "active" })} disabled={act.isPending}>
                  {w.status === "active" ? "Disable" : "Re-enable"}
                </Button>
              )}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

/** Storage used against the allowance, with a field to change the allowance (blank = the default). */
function StorageLimit({ workspace: w, saving, onSave }: { workspace: AdminWorkspace; saving: boolean; onSave: (gb: number | null) => void }) {
  const current = Math.round(w.storageLimitBytes / 1024 ** 3);
  const [value, setValue] = useState(w.customLimit ? String(current) : "");
  const pct = Math.min(100, Math.round((w.storageBytes / w.storageLimitBytes) * 100));
  const parsed = value.trim() === "" ? null : Number(value);
  const valid = parsed === null || (Number.isInteger(parsed) && parsed >= 1 && parsed <= 10000);
  const changed = (parsed ?? null) !== (w.customLimit ? current : null);
  return (
    <div className="mt-2 space-y-1.5">
      <p className="text-sm text-muted-foreground">
        {gigabytes(w.storageBytes)} of {current} GB used ({pct}%){w.customLimit ? "" : " · default allowance"}
      </p>
      <div className="h-1.5 w-56 overflow-hidden rounded-full bg-muted" aria-hidden="true">
        <div className={pct >= 90 ? "h-full bg-destructive" : "h-full bg-primary"} style={{ width: `${pct}%` }} />
      </div>
      <div className="flex items-center gap-2">
        <label htmlFor={`limit-${w.id}`} className="text-xs text-muted-foreground">Allowance (GB)</label>
        <Input id={`limit-${w.id}`} inputMode="numeric" className="h-8 w-24" placeholder="default" value={value} onChange={(e) => setValue(e.target.value.replace(/[^0-9]/g, ""))} />
        <Button size="sm" variant="outline" disabled={!valid || !changed || saving} onClick={() => onSave(parsed)}>Save</Button>
      </div>
    </div>
  );
}
