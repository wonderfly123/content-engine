"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { finishSetup } from "../../flow-actions";

/** Puts the brand live and opens the last step. */
export function FinishButton({ brandId, label }: { brandId: string; label: string }) {
  const [pending, start] = useTransition();
  return (
    <Button
      onClick={() =>
        start(async () => {
          const res = await finishSetup(brandId);
          if (res && !res.ok) toast.error(res.error);
        })
      }
      disabled={pending}
    >
      {pending ? "Finishing…" : label}
    </Button>
  );
}
