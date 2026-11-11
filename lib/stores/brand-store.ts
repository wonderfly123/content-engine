"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface Brand {
  id: string;
  name: string;
  slug: string;
}

interface BrandState {
  active: Brand | null;
  brands: Brand[];
  setActive: (brand: Brand | null) => void;
  setBrands: (brands: Brand[]) => void;
}

// Hard-coded for now; Task 5 wires real data.
export const DEFAULT_BRANDS: Brand[] = [
  { id: "wonderfly", name: "Wonderfly", slug: "wonderfly" },
];

/** Brand opened by default when nothing is selected yet. */
export const DEFAULT_BRAND_SLUG = "personal";

export const useBrandStore = create<BrandState>()(
  persist(
    (set) => ({
      active: DEFAULT_BRANDS[0] ?? null,
      brands: DEFAULT_BRANDS,
      setActive: (active) => set({ active }),
      setBrands: (brands) => set({ brands }),
    }),
    {
      name: "ce.brand",
      // v2: Personal became the default brand; drop any previously remembered choice once.
      version: 2,
      migrate: () => ({ active: null }),
      partialize: (s) => ({ active: s.active }),
    },
  ),
);
