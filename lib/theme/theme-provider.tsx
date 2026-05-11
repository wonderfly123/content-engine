"use client";

import { ThemeProvider as NextThemesProvider, type ThemeProviderProps } from "next-themes";

/**
 * Thin wrapper around next-themes' ThemeProvider so the rest of the app can
 * import a single canonical theme provider from `@/lib/theme/theme-provider`.
 * `app/providers.tsx` is the actual mount point (already wired in bootstrap);
 * this export is here for use by isolated previews/tests if needed.
 */
export function ThemeProvider({ children, ...props }: ThemeProviderProps) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>;
}
