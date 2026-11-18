"use client";

import { usePathname } from "next/navigation";
import { useBrandStore } from "@/lib/stores/brand-store";
import { ThemeToggle } from "./theme-toggle";

const TITLE_OVERRIDES: Record<string, string> = {
  analytics: "Organic",
  conversations: "Chats",
  ads: "Paid",
};

function titleFromPath(pathname: string): string {
  const segs = pathname.split("/").filter(Boolean);
  if (segs.length === 0) return "Calendar";
  let last = segs[segs.length - 1];
  if (!last) return "Calendar";
  // A record page (/conversations/<id>, /drafts/<id>, ...): name it after its section, never show the id.
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(last) && segs.length > 1) {
    const section = segs[segs.length - 2]!;
    const singular: Record<string, string> = { conversations: "Chat", drafts: "Draft", briefs: "Brief", posts: "Post", assets: "Asset" };
    if (singular[section]) return singular[section];
    last = section;
  }
  const override = TITLE_OVERRIDES[last];
  if (override) return override;
  return last
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function Topbar() {
  const pathname = usePathname();
  const title = titleFromPath(pathname);
  const brand = useBrandStore((s) => s.active);

  return (
    <header className="flex h-14 items-center justify-between border-b bg-background px-6">
      <h1 className="text-lg font-semibold tracking-tight">
        {title}
        {brand && (
          <span className="ml-2 text-sm font-normal text-muted-foreground">
            · {brand.name}
          </span>
        )}
      </h1>
      <div className="flex items-center gap-2">
        <ThemeToggle />
      </div>
    </header>
  );
}
