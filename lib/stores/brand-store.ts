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
      partialize: (s) => ({ active: s.active }),
    },
  ),
);
