import Link from "next/link";
import { MessageSquareText } from "lucide-react";
import { cn } from "@/lib/utils";

/** What GET /api/conversations says about texting for the signed-in person. */
export interface TextingInfo {
  textingEnabled: boolean;
  phoneConfirmed: boolean;
  /** The number to text, formatted, e.g. "(801) 457-0307". */
  textingNumber: string | null;
}

/** This brand's texting card in Settings. */
export const brandTextingHref = (brandId: string) => `/settings?${new URLSearchParams({ brandId, tab: "app" })}`;

/**
 * "Prefer to text the editor?" — shown on the dashboard and Conversations only while texting is on
 * and the person's number is not texting for this brand yet. Nothing once it is.
 */
export function TextEditorBanner({ info, brandId, className }: { info: TextingInfo; brandId: string; className?: string }) {
  if (!info.textingEnabled || info.phoneConfirmed) return null;
  return (
    <div className={cn("flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed bg-background/70 p-4", className)}>
      <div className="flex min-w-0 items-start gap-3">
        <MessageSquareText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-sm font-medium">Prefer to text the editor?</p>
          <p className="text-sm text-muted-foreground">
            Turn it on for this brand, then text &ldquo;new reel&rdquo;{info.textingNumber ? <> to {info.textingNumber}</> : null}.
          </p>
        </div>
      </div>
      <Link
        href={brandTextingHref(brandId)}
        className="inline-flex h-8 items-center rounded-md border bg-background px-3 text-sm font-medium shadow-sm transition-colors hover:bg-muted"
      >
        Set up texting
      </Link>
    </div>
  );
}
