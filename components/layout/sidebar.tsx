"use client";

import {
  BadgeCheck,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  FolderOpen,
  LayoutDashboard,
  Mic,
  Plus,
  Settings,
  ShieldCheck,
  TrendingUp,
} from "lucide-react";
import { useRef, useState } from "react";
import { useSidebarStore } from "@/lib/stores/sidebar-store";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ScrollArea } from "@/components/ui/scroll-area";
import { BrandSwitcher } from "./brand-switcher";
import { NavLink } from "./nav-link";
import { AlertBadge } from "./alert-badge";

const mainLinks = [
  { href: "/dashboard", icon: LayoutDashboard, label: "Dashboard" },
  { href: "/calendar", icon: Calendar, label: "Calendar" },
];

// Review Pipeline: each group is one pipeline, its links are the stages in order.
const instagramStages = [
  { href: "/instagram/cuts", icon: Clapperboard, label: "Cut review" },
  { href: "/instagram/voiceover", icon: Mic, label: "Voice-over" },
  { href: "/instagram/final", icon: BadgeCheck, label: "Final review" },
];

const analyticsLinks = [
  { href: "/analytics", icon: TrendingUp, label: "Organic" },
];

function SectionLabel({ collapsed, children }: { collapsed: boolean; children: string }) {
  return (
    <div className={cn("px-3 pt-3 pb-1", collapsed && "px-2")}>
      {!collapsed && (
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {children}
        </span>
      )}
      {collapsed && <Separator />}
    </div>
  );
}

function StageGroup({
  collapsed,
  label,
  links,
}: {
  collapsed: boolean;
  label: string;
  links: typeof instagramStages;
}) {
  return (
    <>
      {!collapsed && (
        <span className="px-3 pt-2 text-xs text-muted-foreground">{label}</span>
      )}
      <div className={cn("flex flex-col gap-1", !collapsed && "ml-3 border-l pl-1")}>
        {links.map((l) => (
          <NavLink key={l.href} {...l} collapsed={collapsed} />
        ))}
      </div>
    </>
  );
}

export function Sidebar() {
  // `pinnedClosed` is the remembered choice. Unpinned, the rail opens on hover
  // over the page (it does not push content) and closes shortly after leaving.
  const { collapsed: pinnedClosed, toggle } = useSidebarStore();
  const [hovered, setHovered] = useState(false);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const collapsed = pinnedClosed && !hovered;

  const onEnter = () => {
    if (leaveTimer.current) clearTimeout(leaveTimer.current);
    setHovered(true);
  };
  const onLeave = () => {
    leaveTimer.current = setTimeout(() => setHovered(false), 150);
  };

  return (
    <TooltipProvider delayDuration={100}>
     <div className={cn("relative h-screen shrink-0 transition-[width] duration-200", pinnedClosed ? "w-16" : "w-60")}>
      <aside
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
        className={cn(
          "absolute inset-y-0 left-0 z-40 flex h-screen flex-col border-r bg-background transition-[width] duration-200",
          collapsed ? "w-16" : "w-60",
          pinnedClosed && hovered && "shadow-xl",
        )}
        aria-label="Main navigation"
      >
        <div className={cn("flex flex-col gap-2 p-3", collapsed && "items-center p-2")}>
          <span
            className={cn("px-1 text-sm font-semibold tracking-tight", collapsed && "px-0 text-xs")}
            aria-label="Content Engine"
          >
            {collapsed ? "CE" : "Content Engine"}
          </span>
          <BrandSwitcher collapsed={collapsed} />
        </div>

        <Separator />

        <ScrollArea className="flex-1">
          <nav className={cn("flex flex-col gap-1 p-2", collapsed && "p-1")}>
            {mainLinks.map((l) => (
              <NavLink key={l.href} {...l} collapsed={collapsed} />
            ))}

            <SectionLabel collapsed={collapsed}>Review Pipeline</SectionLabel>
            <StageGroup collapsed={collapsed} label="Instagram Reels" links={instagramStages} />

            <SectionLabel collapsed={collapsed}>Analytics</SectionLabel>
            {analyticsLinks.map((l) => (
              <NavLink key={l.href} {...l} collapsed={collapsed} />
            ))}

            <Separator className="my-2" />

            <NavLink href="/assets" icon={FolderOpen} label="Assets" collapsed={collapsed} />
            <AlertBadge collapsed={collapsed} />
            <NavLink href="/admin" icon={ShieldCheck} label="Admin" collapsed={collapsed} />
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
            aria-label={pinnedClosed ? "Keep sidebar open" : "Collapse sidebar"}
          >
            {collapsed ? (
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            ) : pinnedClosed ? (
              <>
                <ChevronRight className="mr-2 h-4 w-4" aria-hidden="true" />
                Keep open
              </>
            ) : (
              <>
                <ChevronLeft className="mr-2 h-4 w-4" aria-hidden="true" />
                Collapse
              </>
            )}
          </Button>
        </div>
      </aside>
     </div>
    </TooltipProvider>
  );
}
