"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

interface SidebarState {
  collapsed: boolean;
  mobileOpen: boolean;
  toggle: () => void;
  setCollapsed: (v: boolean) => void;
  setMobileOpen: (v: boolean) => void;
}

export const useSidebarStore = create<SidebarState>()(
  persist(
    (set) => ({
      // Closed by default; the rail opens on hover (see Sidebar).
      collapsed: true,
      mobileOpen: false,
      toggle: () => set((s) => ({ collapsed: !s.collapsed })),
      setCollapsed: (collapsed) => set({ collapsed }),
      setMobileOpen: (mobileOpen) => set({ mobileOpen }),
    }),
    {
      name: "ce.sidebar",
      version: 2, // v2: hover-to-open rail; start everyone closed once
      migrate: () => ({ collapsed: true }),
      partialize: (s) => ({ collapsed: s.collapsed }),
    },
  ),
);
