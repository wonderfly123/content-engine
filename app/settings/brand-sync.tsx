"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useBrandStore } from "@/lib/stores/brand-store";

/**
 * Keeps Settings on the brand chosen in the sidebar switcher. That choice lives in the browser, so
 * the server page can't see it; when it differs from the brand the page rendered, reload with
 * ?brandId= (which the page checks against the caller's own brands).
 */
export function SettingsBrandSync({ renderedBrandId }: { renderedBrandId: string | null }) {
  const active = useBrandStore((s) => s.active);
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  useEffect(() => {
    if (!active || active.id === renderedBrandId) return;
    const next = new URLSearchParams(params.toString());
    next.set("brandId", active.id);
    router.replace(`${pathname}?${next.toString()}`);
  }, [active, renderedBrandId, params, pathname, router]);

  return null;
}
