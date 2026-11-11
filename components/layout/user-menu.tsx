"use client";

import { useEffect, useState } from "react";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { accessFromClaims, type Access } from "@/lib/auth/access";
import { createClient } from "@/lib/supabase/browser";
import { supabaseEnv } from "@/lib/supabase/env";
import { cn } from "@/lib/utils";

/** The signed-in user, for display only. Authorization happens on the server. */
export function useCurrentUser(): Access | null {
  const [user, setUser] = useState<Access | null>(null);
  useEffect(() => {
    if (!supabaseEnv()) return;
    const supabase = createClient();
    const read = (session: { user: { id: string; email?: string; app_metadata?: Record<string, unknown> } } | null) =>
      setUser(session ? accessFromClaims({ sub: session.user.id, email: session.user.email, app_metadata: session.user.app_metadata }) : null);
    void supabase.auth.getSession().then(({ data }) => read(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => read(session));
    return () => sub.subscription.unsubscribe();
  }, []);
  return user;
}

export function UserMenu({ collapsed, user }: { collapsed: boolean; user: Access | null }) {
  if (!user) return null;
  return (
    <form action="/auth/signout" method="post" className={cn("flex items-center gap-2 px-1 py-1", collapsed && "justify-center px-0")}>
      {!collapsed && (
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium" title={user.email}>{user.email}</p>
          <p className="text-xs capitalize text-muted-foreground">{user.role}</p>
        </div>
      )}
      <Button type="submit" variant="ghost" size="sm" className="h-8 w-8 shrink-0 p-0" aria-label="Sign out" title="Sign out">
        <LogOut className="h-4 w-4" aria-hidden="true" />
      </Button>
    </form>
  );
}
