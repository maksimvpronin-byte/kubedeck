import type { DarkTheme, Theme } from "@kubedeck/shared-types";

export type ResolvedTheme = "light" | DarkTheme;

export interface ThemeOption {
  id: Theme;
  labelKey: string;
  descriptionKey: string;
  preview: readonly [string, string, string];
}

export const THEME_OPTIONS: readonly ThemeOption[] = [
  { id: "system", labelKey: "settings.theme.system", descriptionKey: "settings.theme.system.description", preview: ["#eef3f8", "#18212b", "#4d94b7"] },
  { id: "light", labelKey: "settings.theme.light", descriptionKey: "settings.theme.light.description", preview: ["#eef3f8", "#ffffff", "#1f6f8f"] },
  { id: "midnight", labelKey: "settings.theme.midnight", descriptionKey: "settings.theme.midnight.description", preview: ["#18212b", "#202b36", "#4d94b7"] },
  { id: "nord", labelKey: "settings.theme.nord", descriptionKey: "settings.theme.nord.description", preview: ["#242b38", "#303847", "#88c0d0"] },
  { id: "forest", labelKey: "settings.theme.forest", descriptionKey: "settings.theme.forest.description", preview: ["#172623", "#20332f", "#5fb3a2"] },
  { id: "plum", labelKey: "settings.theme.plum", descriptionKey: "settings.theme.plum.description", preview: ["#25212b", "#332d3b", "#b194c7"] },
  { id: "mocha", labelKey: "settings.theme.mocha", descriptionKey: "settings.theme.mocha.description", preview: ["#29231f", "#39302a", "#d0a66e"] },
] as const;

const SYSTEM_DARK_QUERY = "(prefers-color-scheme: dark)";
const STORAGE_KEY = "kubedeck.theme";
const THEMES = new Set<Theme>(THEME_OPTIONS.map(({ id }) => id));

export function normalizeThemePreference(value: unknown): Theme {
  if (value === "dark") return "midnight";
  return typeof value === "string" && THEMES.has(value as Theme) ? (value as Theme) : "midnight";
}

export function getSystemThemeMedia(): MediaQueryList | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  return window.matchMedia(SYSTEM_DARK_QUERY);
}

export function resolveTheme(theme: Theme | string, media = getSystemThemeMedia()): ResolvedTheme {
  const normalized = normalizeThemePreference(theme);
  if (normalized !== "system") return normalized;
  return media?.matches ? "midnight" : "light";
}

export function applyThemePreference(theme: Theme | string, media = getSystemThemeMedia(), options: { persist?: boolean } = {}): ResolvedTheme {
  const normalized = normalizeThemePreference(theme);
  const resolved = resolveTheme(normalized, media);
  if (typeof document === "undefined") return resolved;
  const root = document.documentElement;
  root.dataset.themePreference = normalized;
  root.dataset.theme = resolved;
  if (options.persist !== false && typeof localStorage !== "undefined") {
    localStorage.setItem(STORAGE_KEY, normalized);
  }
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("kubedeck-theme-change", { detail: resolved }));
  return resolved;
}

export function restoreStoredThemePreference(): ResolvedTheme {
  let stored: string | null = null;
  try {
    stored = typeof localStorage === "undefined" ? null : localStorage.getItem(STORAGE_KEY);
  } catch {
    // A restrictive browser storage policy must not prevent startup.
  }
  return applyThemePreference(stored ?? "system", getSystemThemeMedia(), { persist: false });
}
