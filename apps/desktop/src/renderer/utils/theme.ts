import type { Theme } from "../types";

export type ResolvedTheme = "dark" | "light";

const SYSTEM_DARK_QUERY = "(prefers-color-scheme: dark)";

export function getSystemThemeMedia(): MediaQueryList | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  return window.matchMedia(SYSTEM_DARK_QUERY);
}

export function resolveTheme(theme: Theme, media = getSystemThemeMedia()): ResolvedTheme {
  if (theme === "dark" || theme === "light") return theme;
  return media?.matches ? "dark" : "light";
}

export function applyThemePreference(theme: Theme, media = getSystemThemeMedia()): ResolvedTheme {
  const resolved = resolveTheme(theme, media);
  const root = document.documentElement;
  root.dataset.themePreference = theme;
  root.dataset.theme = resolved;
  return resolved;
}
