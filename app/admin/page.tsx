"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { AdminUser } from "@/app/api/admin/users/route";

const USER_STATUS: Record<AdminUser["status"], string> = { pending: "Not set up yet", active: "Active", disabled: "Disabled" };

async function usersRequest(body?: { id: string; action: string }): Promise<AdminUser[]> {
  const res = await fetch("/api/admin/users", body
    ? { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
    : { cache: "no-store" });
  const json = (await res.json().catch(() => ({}))) as { users?: AdminUser[]; error?: string };
  if (!res.ok || !json.users) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json.users;
}

/** Admin > People: everyone who has signed up. Only the platform admin sees this. */
export default function AdminPeoplePage() {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery({ queryKey: ["admin-users"], queryFn: () => usersRequest(), refetchInterval: 60_000 });
  const act = useMutation({
    mutationFn: (v: { id: string; action: string }) => usersRequest(v),
    onSuccess: (rows) => { qc.setQueryData(["admin-users"], rows); toast.success("Updated"); },
    onError: (e) => toast.error((e as Error).message),
  });
  return (
    <Card className="max-w-4xl">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">People</CardTitle>
        <p className="text-sm text-muted-foreground">Everyone who has signed up. New accounts are active straight away; you can disable one here. Changes can take up to an hour to reach someone already signed in.</p>
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
              {u.status !== "active" && <Button size="sm" onClick={() => act.mutate({ id: u.id, action: "approve" })} disabled={act.isPending}>{u.status === "disabled" ? "Re-enable" : "Activate"}</Button>}
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
