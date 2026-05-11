"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export interface NavLinkProps {
  href: string;
  icon: LucideIcon;
  label: string;
  collapsed?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  exact?: boolean;
}

export function NavLink({
  href,
  icon: Icon,
  label,
  collapsed = false,
  disabled = false,
  disabledReason = "Coming soon",
  exact = false,
}: NavLinkProps) {
  const pathname = usePathname();
  const active = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);

  const base = cn(
    "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
    collapsed && "justify-center px-2",
    active && !disabled && "bg-accent text-accent-foreground font-medium",
    !active && !disabled && "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
    disabled && "text-muted-foreground/50 cursor-not-allowed",
  );

  const content = (
    <>
      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      {!collapsed && <span className="truncate">{label}</span>}
    </>
  );

  if (disabled) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            className={base}
            aria-disabled="true"
            role="link"
            tabIndex={-1}
            aria-label={`${label} (${disabledReason})`}
          >
            {content}
          </div>
        </TooltipTrigger>
        <TooltipContent side="right">{disabledReason}</TooltipContent>
      </Tooltip>
    );
  }

  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Link
            href={href}
            className={base}
            aria-current={active ? "page" : undefined}
            aria-label={label}
          >
            {content}
          </Link>
        </TooltipTrigger>
        <TooltipContent side="right">{label}</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Link href={href} className={base} aria-current={active ? "page" : undefined}>
      {content}
    </Link>
  );
}
