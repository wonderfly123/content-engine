"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/browser";

/** Re-issues the session so a fresh approval shows up, then lets the middleware route the user on. */
export function PendingActions({ disabled }: { disabled: boolean }) {
  const router = useRouter();
  const [checking, setChecking] = useState(false);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);

  const check = async () => {
    setChecking(true);
    try {
      await createClient().auth.refreshSession();
      router.refresh();
      setCheckedAt(new Date());
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    if (disabled) return;
    const id = setInterval(check, 30_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled]);

  return (
    <div className="flex flex-col gap-2">
      {!disabled && (
        <Button onClick={check} disabled={checking} variant="outline">
          {checking ? "Checking…" : "Check now"}
        </Button>
      )}
      <form action="/auth/signout" method="post">
        <Button type="submit" variant="ghost" className="w-full">Sign out</Button>
      </form>
      {checkedAt && <p className="mt-2 text-xs text-muted-foreground">Last checked {checkedAt.toLocaleTimeString()}</p>}
    </div>
  );
}
