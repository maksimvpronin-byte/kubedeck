import type { Language } from "../types";

export type ResolvedLanguage = "en" | "ru";

export function resolveLanguage(language: Language): ResolvedLanguage {
  if (language === "ru" || language === "en") return language;
  const systemLanguage = typeof navigator === "undefined" ? "" : navigator.language;
  return systemLanguage.toLowerCase().startsWith("ru") ? "ru" : "en";
}

export function applyLanguagePreference(language: Language): ResolvedLanguage {
  const resolved = resolveLanguage(language);
  const root = document.documentElement;
  root.lang = resolved;
  root.dataset.languagePreference = language;
  root.dataset.language = resolved;
  return resolved;
}
