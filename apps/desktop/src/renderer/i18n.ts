import en from "./locales/en.json";
import ru from "./locales/ru.json";
import type { Language } from "./types";

const dictionaries = { en, ru };

export function resolveLanguage(language: Language): "en" | "ru" {
  if (language === "ru" || language === "en") return language;
  return navigator.language.toLowerCase().startsWith("ru") ? "ru" : "en";
}

export function createTranslator(language: Language) {
  const resolved = resolveLanguage(language);
  const dictionary = dictionaries[resolved] as Record<string, string>;
  return (key: string) => dictionary[key] ?? key;
}
