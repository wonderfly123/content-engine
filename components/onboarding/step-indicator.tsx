import { Check } from "lucide-react";
import { FLOW_STEPS } from "@/lib/onboarding/flow";
import { cn } from "@/lib/utils";

interface StepIndicatorProps {
  current: number;
  /** Steps left out of the bar (e.g. "Connect Claude" when the workspace already has a working key). */
  hidden?: number[];
}

export function StepIndicator({ current, hidden = [] }: StepIndicatorProps) {
  const steps = FLOW_STEPS.filter((s) => !hidden.includes(s.n));
  return (
    <ol aria-label="Onboarding progress" className="flex flex-wrap items-center gap-1.5 text-xs">
      {steps.map((s, i) => {
        const done = s.n < current;
        const active = s.n === current;
        return (
          <li key={s.n} className="flex items-center gap-1.5">
            <span
              className={cn(
                "flex h-6 w-6 items-center justify-center rounded-full border text-[11px] font-medium",
                done && "border-primary bg-primary text-primary-foreground",
                active && "border-primary bg-background text-foreground ring-2 ring-primary/30",
                !done && !active && "border-muted bg-muted/40 text-muted-foreground",
              )}
              aria-current={active ? "step" : undefined}
            >
              {done ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : i + 1}
            </span>
            <span className={cn("hidden sm:inline", active ? "text-foreground" : "text-muted-foreground")}>{s.label}</span>
            {i < steps.length - 1 && <span aria-hidden="true" className="mx-1 h-px w-4 bg-border" />}
          </li>
        );
      })}
    </ol>
  );
}
