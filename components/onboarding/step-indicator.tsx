import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export const ONBOARDING_STEPS = [
  { n: 1, label: "Tell us" },
  { n: 2, label: "Analyzing" },
  { n: 3, label: "Profile" },
  { n: 4, label: "ICPs" },
  { n: 5, label: "Competitors" },
  { n: 6, label: "Cadence" },
  { n: 7, label: "Channels" },
  { n: 8, label: "Done" },
] as const;

interface StepIndicatorProps {
  current: number;
}

export function StepIndicator({ current }: StepIndicatorProps) {
  return (
    <ol
      aria-label="Onboarding progress"
      className="flex flex-wrap items-center gap-1.5 text-xs"
    >
      {ONBOARDING_STEPS.map((s, i) => {
        const done = s.n < current;
        const active = s.n === current;
        return (
          <li key={s.n} className="flex items-center gap-1.5">
            <span
              className={cn(
                "flex h-6 w-6 items-center justify-center rounded-full border text-[11px] font-medium",
                done && "border-primary bg-primary text-primary-foreground",
                active &&
                  "border-primary bg-background text-foreground ring-2 ring-primary/30",
                !done && !active && "border-muted bg-muted/40 text-muted-foreground",
              )}
              aria-current={active ? "step" : undefined}
            >
              {done ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : s.n}
            </span>
            <span
              className={cn(
                "hidden sm:inline",
                active ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {s.label}
            </span>
            {i < ONBOARDING_STEPS.length - 1 && (
              <span aria-hidden="true" className="mx-1 h-px w-4 bg-border" />
            )}
          </li>
        );
      })}
    </ol>
  );
}
