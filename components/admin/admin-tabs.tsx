"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/admin", label: "People" },
  { href: "/admin/workspaces", label: "Workspaces" },
  { href: "/admin/skill", label: "Editor skill" },
  { href: "/admin/connections", label: "Connections" },
  { href: "/admin/music", label: "Music" },
  { href: "/admin/storage", label: "Storage" },
] as const;

/** The Admin section's tabs; each tab is its own page under /admin. */
export function AdminTabs() {
  const pathname = usePathname();
  return (
    <nav aria-label="Admin sections" className="flex gap-1 overflow-x-auto border-b">
      {TABS.map((t) => {
        const active = t.href === "/admin" ? pathname === "/admin" : pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px shrink-0 border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
