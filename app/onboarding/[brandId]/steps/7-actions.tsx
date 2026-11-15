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

  const finish = () => {
    startTransition(async () => {
      const res = await markActive(brandId);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      router.push(`/dashboard?brand=${res.data.slug}`);
    });
  };

  return (
    <div className="flex flex-wrap gap-2">
      <Button onClick={finish} disabled={pending}>
        {pending ? "Activating…" : "Go to dashboard"}
      </Button>
    </div>
  );
}
