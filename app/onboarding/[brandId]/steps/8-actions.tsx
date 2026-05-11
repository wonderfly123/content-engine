"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { markActive } from "../actions";

interface DoneActionsProps {
  brandId: string;
}

export function DoneActions({ brandId }: DoneActionsProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const finish = (triggerResearch: boolean) => {
    startTransition(async () => {
      const res = await markActive(brandId, { triggerResearch });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      if (triggerResearch) {
        toast.success("Research enqueued. You can leave this page.");
      }
      router.push(`/dashboard?brand=${res.data.slug}`);
    });
  };

  return (
    <div className="flex flex-wrap gap-2">
      <Button
        variant="outline"
        onClick={() => finish(true)}
        disabled={pending}
      >
        Run research now
      </Button>
      <Button onClick={() => finish(false)} disabled={pending}>
        {pending ? "Activating…" : "Go to dashboard"}
      </Button>
    </div>
  );
}
