"use client";

import { Star } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/**
 * A faint star marker overlaid on calendar slots that match a top-performing
 * day-of-week × hour slot for the brand × format. Reads no data on its own —
 * the parent decides when to render it.
 */
export function OptimalTimeBadge({ className = "" }: { className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={`inline-flex items-center text-amber-500/70 ${className}`}
          aria-label="Top-performing slot"
        >
          <Star className="h-3 w-3" fill="currentColor" />
        </span>
      </TooltipTrigger>
      <TooltipContent side="top">
        <p className="text-xs">Top-performing slot for this brand and format</p>
      </TooltipContent>
    </Tooltip>
  );
}
