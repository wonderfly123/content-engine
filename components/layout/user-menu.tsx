"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Bell, ChevronsUpDown, LogOut, Plus, Settings, ShieldCheck } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { accessFromClaims, type Access } from "@/lib/auth/access";
import { createClient } from "@/lib/supabase/browser";
import { supabaseEnv } from "@/lib/supabase/env";
import { cn } from "@/lib/utils";
import { AlertsSheet, useAlerts } from "./alert-badge";

/** The signed-in user, for display only. Authorization happens on the server. */
export interface CurrentUser extends Access {
  /** Name from the sign-in provider (Google gives one; email sign-ups may not). */
  name: string | null;
}

type SessionUser = { id: string; email?: string; app_metadata?: Record<string, unknown>; user_metadata?: Record<string, unknown> };

function nameOf(u: SessionUser): string | null {
  const meta = u.user_metadata ?? {};
  for (const key of ["full_name", "name"]) {
    const v = meta[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

export function useCurrentUser(): CurrentUser | null {
  const [user, setUser] = useState<CurrentUser | null>(null);
  useEffect(() => {
    if (!supabaseEnv()) return;
    const supabase = createClient();
    const read = (session: { user: SessionUser } | null) => {
      if (!session) return setUser(null);
      const access = accessFromClaims({ sub: session.user.id, email: session.user.email, app_metadata: session.user.app_metadata });
      setUser(access ? { ...access, name: nameOf(session.user) } : null);
    };
    void supabase.auth.getSession().then(({ data }) => read(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => read(session));
    return () => sub.subscription.unsubscribe();
  }, []);
  return user;
}

const initials = (user: CurrentUser) => {
  const source = user.name ?? user.email;
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (user.name ? parts[1]?.[0] ?? "" : "")).toUpperCase() || "?";
};

/** Your name at the bottom of the sidebar; click it for alerts, settings, adding a brand, admin and signing out. */
export function UserMenu({ collapsed, user }: { collapsed: boolean; user: CurrentUser | null }) {
  const [alertsOpen, setAlertsOpen] = useState(false);
  const { data: alerts } = useAlerts();
  if (!user) return null;
  const label = user.name ?? user.email;
  const alertCount = alerts?.length ?? 0;
  return (
    <>
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50",
          collapsed && "justify-center px-0",
        )}
        aria-label="Account menu"
      >
        <span className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-amber-500 to-orange-600 text-xs font-semibold text-white">
          {initials(user)}
          {alertCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-background bg-destructive" aria-label={`${alertCount} alerts`} />
          )}
        </span>
        {!collapsed && (
          <>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium" title={label}>{label}</span>
              {user.name && <span className="block truncate text-xs text-muted-foreground" title={user.email}>{user.email}</span>}
            </span>
            <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          </>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-56">
        <DropdownMenuLabel className="font-normal">
          <span className="block truncate text-sm font-medium">{label}</span>
          {user.name && <span className="block truncate text-xs text-muted-foreground">{user.email}</span>}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => setAlertsOpen(true)}>
          <Bell aria-hidden="true" />
          Alerts
          {alertCount > 0 && <span className="ml-auto rounded-full bg-destructive px-1.5 text-[10px] font-semibold text-destructive-foreground">{alertCount > 9 ? "9+" : alertCount}</span>}
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/settings"><Settings aria-hidden="true" />Settings</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/onboarding"><Plus aria-hidden="true" />Add brand</Link>
        </DropdownMenuItem>
        {user.role === "admin" && (
          <DropdownMenuItem asChild>
            <Link href="/admin"><ShieldCheck aria-hidden="true" />Admin</Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <form action="/auth/signout" method="post">
          <DropdownMenuItem asChild>
            <button type="submit" className="w-full"><LogOut aria-hidden="true" />Sign out</button>
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
    <AlertsSheet open={alertsOpen} onOpenChange={setAlertsOpen} />
    </>
  );
}
