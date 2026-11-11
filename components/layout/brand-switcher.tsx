"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import {
  DEFAULT_BRANDS,
  DEFAULT_BRAND_SLUG,
  useBrandStore,
  type Brand,
} from "@/lib/stores/brand-store";
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

interface ApiBrandRow {
  id: string;
  name: string;
  slug: string;
  status: "draft" | "active" | "archived";
}

async function fetchBrands(): Promise<ApiBrandRow[]> {
  const res = await fetch("/api/brands", { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = (await res.json()) as { brands: ApiBrandRow[] };
  return json.brands;
}

export function BrandSwitcher({ collapsed = false }: BrandSwitcherProps) {
  const router = useRouter();
  const { active, brands, setActive, setBrands } = useBrandStore();

  // Live brand list from the API; falls back to the persisted store on error.
  const { data, error } = useQuery({
    queryKey: ["brands"],
    queryFn: fetchBrands,
    staleTime: 60_000,
    retry: 1,
  });

  useEffect(() => {
    if (!data) return;
    const activeOnly = data
      .filter((b) => b.status === "active")
      .map((b) => ({ id: b.id, name: b.name, slug: b.slug }));
    const next = activeOnly.length > 0 ? activeOnly : DEFAULT_BRANDS;
    setBrands(next);
    if (!active || !next.some((b) => b.id === active.id)) {
      setActive(next.find((b) => b.slug === DEFAULT_BRAND_SLUG) ?? next[0] ?? null);
    }
  }, [data, active, setActive, setBrands]);

  // On error, keep hardcoded fallback (already in store).
  void error;

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
