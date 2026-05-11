"use client";

import { Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { assetKindValues, type AssetKind } from "@/lib/db/enums";
import { KIND_LABEL } from "./kind-icon";

interface Props {
  kind: AssetKind | null;
  onKindChange: (k: AssetKind | null) => void;
  search: string;
  onSearchChange: (s: string) => void;
  tags: string[];
  selectedTag: string | null;
  onTagChange: (t: string | null) => void;
}

export function AssetFilterBar({
  kind,
  onKindChange,
  search,
  onSearchChange,
  tags,
  selectedTag,
  onTagChange,
}: Props) {
  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Search by label…"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <Chip
          active={kind === null}
          onClick={() => onKindChange(null)}
          label="All"
        />
        {assetKindValues.map((k) => (
          <Chip
            key={k}
            active={kind === k}
            onClick={() => onKindChange(k)}
            label={KIND_LABEL[k]}
          />
        ))}
      </div>
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <Chip
            active={selectedTag === null}
            onClick={() => onTagChange(null)}
            label="All tags"
          />
          {tags.map((t) => (
            <Chip
              key={t}
              active={selectedTag === t}
              onClick={() => onTagChange(t)}
              label={t}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Chip({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <Badge
      asChild
      variant={active ? "default" : "outline"}
      className={cn("cursor-pointer", active && "shadow-sm")}
    >
      <button type="button" onClick={onClick}>
        {label}
      </button>
    </Badge>
  );
}
