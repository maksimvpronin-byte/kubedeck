import en from "./locales/en.json";
import ru from "./locales/ru.json";
import type { Language } from "./types";
import { resolveLanguage } from "./utils/language";

const dictionaries = { en, ru };

export function createTranslator(language: Language) {
  const resolved = resolveLanguage(language);
  const dictionary = dictionaries[resolved] as Record<string, string>;
  return (key: string) => dictionary[key] ?? key;
}
