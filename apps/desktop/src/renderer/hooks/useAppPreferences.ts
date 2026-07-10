import { useEffect, useState } from "react";
import type { Settings } from "../types";
import { applyLanguagePreference } from "../utils/language";
import { applyThemePreference, getSystemThemeMedia } from "../utils/theme";

export function useAppPreferences(settings: Settings | undefined, activeLanguage: Settings["language"]) {
  const [systemLanguageVersion, setSystemLanguageVersion] = useState(0);

  useEffect(() => {
    if (!settings) return undefined;
    const media = getSystemThemeMedia();
    const applyTheme = () => applyThemePreference(settings.theme, media);
    applyTheme();
    if (settings.theme !== "system" || !media) return undefined;
    media.addEventListener("change", applyTheme);
    return () => media.removeEventListener("change", applyTheme);
  }, [settings?.theme]);

  useEffect(() => {
    const applyLanguage = () => {
      applyLanguagePreference(activeLanguage);
      if (activeLanguage === "system") setSystemLanguageVersion((version) => version + 1);
    };
    applyLanguage();
    if (activeLanguage !== "system" || typeof window === "undefined") return undefined;
    window.addEventListener("languagechange", applyLanguage);
    return () => window.removeEventListener("languagechange", applyLanguage);
  }, [activeLanguage]);

  return systemLanguageVersion;
}
