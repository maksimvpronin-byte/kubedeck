(() => {
  const themes = new Set(["system", "light", "midnight", "nord", "forest", "plum", "mocha"]);
  let preference = "system";
  try {
    const stored = localStorage.getItem("kubedeck.theme");
    if (stored !== null) {
      preference = stored === "dark" ? "midnight" : themes.has(stored) ? stored : "midnight";
    }
  } catch {
    // Storage can be unavailable under restrictive browser policies.
  }
  const resolved = preference === "system" ? (matchMedia("(prefers-color-scheme: dark)").matches ? "midnight" : "light") : preference;
  document.documentElement.dataset.themePreference = preference;
  document.documentElement.dataset.theme = resolved;
})();
