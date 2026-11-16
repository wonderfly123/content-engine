"use client";

import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Clapperboard, PartyPopper } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useBrandStore, type Brand } from "@/lib/stores/brand-store";

/** Step 7. "Make your first video" opens the dashboard on the new brand, at its start card. */
export function Done({ brand }: { brand: Brand }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const setActive = useBrandStore((s) => s.setActive);

  const go = () => {
    // Drop the cached brand list so the switcher loads it fresh (with this brand) instead of resetting.
    queryClient.removeQueries({ queryKey: ["brands"] });
    setActive(brand);
    router.push(`/dashboard?brand=${encodeURIComponent(brand.slug)}#start-video`);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <PartyPopper className="h-5 w-5 text-primary" aria-hidden="true" />
          {brand.name} is ready
        </CardTitle>
        <CardDescription>Your editor now knows how {brand.name} sounds and which facts it may use.</CardDescription>
      </CardHeader>
      <CardContent>
        <Button size="lg" onClick={go}>
          <Clapperboard className="mr-2 h-4 w-4" aria-hidden="true" />
          Make your first video
        </Button>
      </CardContent>
    </Card>
  );
}
