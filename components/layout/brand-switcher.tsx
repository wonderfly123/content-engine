"use client";

import { useRouter } from "next/navigation";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { useBrandStore, type Brand } from "@/lib/stores/brand-store";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

interface BrandSwitcherProps {
  collapsed?: boolean;
}

export function BrandSwitcher({ collapsed = false }: BrandSwitcherProps) {
  const router = useRouter();
  const { active, brands, setActive } = useBrandStore();

  const handleSelect = (brand: Brand) => {
    setActive(brand);
    router.push(`/dashboard?brand=${brand.slug}`);
  };

  const handleAddBrand = () => {
    router.push("/onboarding");
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            "w-full justify-between",
            collapsed && "px-2 justify-center",
          )}
          aria-label="Switch brand"
        >
          {collapsed ? (
            <span className="text-xs font-semibold">
              {(active?.name ?? "?").slice(0, 1).toUpperCase()}
            </span>
          ) : (
            <>
              <span className="truncate text-left">
                {active?.name ?? "Select brand"}
              </span>
              <ChevronsUpDown className="h-4 w-4 opacity-60 shrink-0" aria-hidden="true" />
            </>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel>Brands</DropdownMenuLabel>
        {brands.map((brand) => (
          <DropdownMenuItem
            key={brand.id}
            onSelect={() => handleSelect(brand)}
            className="flex items-center justify-between"
          >
            <span>{brand.name}</span>
            {active?.id === brand.id && (
              <Check className="h-4 w-4" aria-hidden="true" />
            )}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={handleAddBrand}>
          <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
          Add brand
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
