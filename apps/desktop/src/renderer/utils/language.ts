import type { Language } from "../types";

export type ResolvedLanguage = "en" | "ru";

export function resolveLanguage(language: Language): ResolvedLanguage {
  if (language === "ru" || language === "en") return language;
  const systemLanguage = typeof navigator === "undefined" ? "" : navigator.language;
  return systemLanguage.toLowerCase().startsWith("ru") ? "ru" : "en";
}

// The boot screen runs before the bundle, so it cannot ask the gateway which
// language the settings hold. It reads the resolved language from here instead,
// the same way theme-bootstrap.js reads the stored theme.
const STORAGE_KEY = "kubedeck.language";

export function applyLanguagePreference(language: Language): ResolvedLanguage {
  const resolved = resolveLanguage(language);
  const root = document.documentElement;
  root.lang = resolved;
  root.dataset.languagePreference = language;
  root.dataset.language = resolved;
  try {
    localStorage.setItem(STORAGE_KEY, resolved);
  } catch {
    // Storage can be unavailable under restrictive browser policies.
  }
  return resolved;
}
