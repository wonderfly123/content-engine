"use client";

import {
  Briefcase,
  Calendar,
  ChevronLeft,
  ChevronRight,
  FileCheck2,
  FileEdit,
  FileText,
  FolderOpen,
  Facebook,
  Home,
  Instagram,
  LayoutDashboard,
  Mail,
  Music2,
  Pin,
  Plus,
  Search,
  Settings,
  TrendingUp,
} from "lucide-react";
import { useSidebarStore } from "@/lib/stores/sidebar-store";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ScrollArea } from "@/components/ui/scroll-area";
import { BrandSwitcher } from "./brand-switcher";
import { NavLink } from "./nav-link";
import { AlertBadge } from "./alert-badge";

const workflowLinks = [
  { href: "/dashboard", icon: LayoutDashboard, label: "Dashboard" },
  { href: "/research", icon: Search, label: "Research" },
  { href: "/briefs", icon: FileEdit, label: "Briefs" },
  { href: "/drafts", icon: FileCheck2, label: "Drafts" },
  { href: "/assets", icon: FolderOpen, label: "Assets" },
  { href: "/calendar", icon: Calendar, label: "Calendar" },
  { href: "/analytics", icon: TrendingUp, label: "Analytics" },
];

const channelLinks = [
  { href: "/instagram", icon: Instagram, label: "Instagram", disabled: false },
  { href: "/facebook", icon: Facebook, label: "Facebook", disabled: false },
  { href: "/blog", icon: FileText, label: "Blog", disabled: true },
  { href: "/newsletter", icon: Mail, label: "Newsletter", disabled: true },
  { href: "/linkedin", icon: Briefcase, label: "LinkedIn", disabled: true },
  { href: "/tiktok", icon: Music2, label: "TikTok", disabled: true },
  { href: "/pinterest", icon: Pin, label: "Pinterest", disabled: true },
];

export function Sidebar() {
  const { collapsed, toggle } = useSidebarStore();

  return (
    <TooltipProvider delayDuration={100}>
      <aside
        className={cn(
          "relative flex h-screen flex-col border-r bg-background transition-[width] duration-200",
          collapsed ? "w-16" : "w-60",
        )}
        aria-label="Main navigation"
      >
        <div className={cn("flex items-center gap-2 p-3", collapsed && "p-2")}>
          <BrandSwitcher collapsed={collapsed} />
        </div>

        <Separator />

        <ScrollArea className="flex-1">
          <nav className={cn("flex flex-col gap-1 p-2", collapsed && "p-1")}>
            <NavLink href="/home" icon={Home} label="Home" collapsed={collapsed} />

            <Separator className="my-2" />

            {workflowLinks.map((l) => (
              <NavLink key={l.href} {...l} collapsed={collapsed} />
            ))}

            <div className={cn("px-3 pt-3 pb-1", collapsed && "px-2")}>
              {!collapsed && (
                <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Channels
                </span>
              )}
              {collapsed && <Separator />}
            </div>

            {channelLinks.map((l) => (
              <NavLink key={l.href} {...l} collapsed={collapsed} />
            ))}

            <Separator className="my-2" />

            <AlertBadge collapsed={collapsed} />
            <NavLink href="/settings" icon={Settings} label="Settings" collapsed={collapsed} />
            <NavLink href="/onboarding" icon={Plus} label="Add Brand" collapsed={collapsed} />
          </nav>
        </ScrollArea>

        <div className="border-t p-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={toggle}
            className="w-full justify-center"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? (
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            ) : (
              <>
                <ChevronLeft className="mr-2 h-4 w-4" aria-hidden="true" />
                Collapse
              </>
            )}
          </Button>
        </div>
      </aside>
    </TooltipProvider>
  );
}
