import { Film, Image as ImageIcon, Music, Shapes } from "lucide-react";
import type { AssetKind } from "@/lib/db/enums";
import { cn } from "@/lib/utils";

interface Props {
  kind: AssetKind;
  className?: string;
}

export function KindIcon({ kind, className }: Props) {
  const Icon =
    kind === "video"
      ? Film
      : kind === "image"
        ? ImageIcon
        : kind === "audio"
          ? Music
          : Shapes;
  return <Icon className={cn("h-4 w-4", className)} aria-hidden />;
}

export const KIND_LABEL: Record<AssetKind, string> = {
  video: "Video",
  image: "Image",
  audio: "Audio",
  graphic: "Graphic",
};
