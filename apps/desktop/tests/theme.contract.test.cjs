// Themes, tokens and colour contrast.
// Split out of renderer-controllers.contract.test.cjs; see
// docs/file-structure-refactor-plan.md, section C.
// A test marked `grep contract` reads a source file and asserts on its text.
// It breaks on a rename and passes through a real regression, so it is a
// placeholder for a behavioural test rather than one. See section C of
// docs/file-structure-refactor-plan.md.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { loadTypeScript, rendererRoot } = require("./helpers/renderer.cjs");

function cssHexTokens(blocks) {
  const result = {};
  for (const [, , body] of blocks) {
    for (const match of body.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)) result[match[1]] = match[2];
  }
  return result;
}

function contrastRatio(first, second) {
  const luminance = (hex) => {
    const channels = [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16) / 255).map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  };
  const values = [luminance(first), luminance(second)];
  return (Math.max(...values) + 0.05) / (Math.min(...values) + 0.05);
}

test("theme preferences normalize legacy values and resolve System safely", () => {
  const model = loadTypeScript("utils/theme.ts");
  const darkMedia = { matches: true };
  const lightMedia = { matches: false };
  assert.equal(model.normalizeThemePreference("dark"), "midnight");
  assert.equal(model.normalizeThemePreference("unknown-theme"), "midnight");
  assert.equal(model.resolveTheme("system", darkMedia), "midnight");
  assert.equal(model.resolveTheme("system", lightMedia), "light");
  assert.equal(model.resolveTheme("nord", lightMedia), "nord");
  assert.equal(model.resolveTheme("graphite", lightMedia), "graphite");
  assert.deepEqual(
    model.THEME_OPTIONS.map(({ id }) => id),
    ["system", "light", "midnight", "nord", "forest", "plum", "mocha", "graphite"],
  );
  const bootstrap = fs.readFileSync(path.join(rendererRoot, "public/theme-bootstrap.js"), "utf8");
  assert.match(bootstrap, /themes = new Set\(\[[^\]]*"graphite"/);
  for (const locale of ["en", "ru"]) {
    const messages = JSON.parse(fs.readFileSync(path.join(rendererRoot, `locales/${locale}.json`), "utf8"));
    assert.ok(messages["settings.theme.graphite"]);
    assert.ok(messages["settings.theme.graphite.description"]);
  }
});

test("theme application updates data attributes and persists the preference", () => {
  const previous = {
    document: global.document,
    localStorage: global.localStorage,
    window: global.window,
    CustomEvent: global.CustomEvent,
  };
  const stored = new Map();
  const events = [];
  global.document = { documentElement: { dataset: {} } };
  global.localStorage = {
    getItem: (key) => stored.get(key) ?? null,
    setItem: (key, value) => stored.set(key, value),
  };
  global.CustomEvent = class CustomEvent {
    constructor(type, init) {
      this.type = type;
      this.detail = init?.detail;
    }
  };
  global.window = {
    dispatchEvent: (event) => events.push(event),
    matchMedia: () => ({ matches: true }),
  };
  try {
    const model = loadTypeScript("utils/theme.ts");
    assert.equal(model.applyThemePreference("plum", { matches: false }), "plum");
    assert.deepEqual(global.document.documentElement.dataset, { themePreference: "plum", theme: "plum" });
    assert.equal(stored.get("kubedeck.theme"), "plum");
    stored.set("kubedeck.theme", "dark");
    assert.equal(model.restoreStoredThemePreference(), "midnight");
    assert.equal(global.document.documentElement.dataset.theme, "midnight");
    assert.equal(events.at(-1).detail, "midnight");
    stored.delete("kubedeck.theme");
    assert.equal(model.restoreStoredThemePreference(), "midnight");
    assert.equal(global.document.documentElement.dataset.themePreference, "system");
  } finally {
    global.document = previous.document;
    global.localStorage = previous.localStorage;
    global.window = previous.window;
    global.CustomEvent = previous.CustomEvent;
  }
});

// grep contract: asserts on source text, not behaviour.
test("every color theme exposes the shared token contract", () => {
  const tokens = fs.readFileSync(path.join(rendererRoot, "styles/tokens.css"), "utf8");
  const required = [
    "app-bg",
    "sidebar-bg",
    "topbar-bg",
    "panel",
    "panel-muted",
    "surface",
    "surface-2",
    "surface-hover",
    "surface-active",
    "surface-selected",
    "focus-ring",
    "text",
    "text-strong",
    "text-inverse",
    "muted",
    "border",
    "border-strong",
    "input-bg",
    "input-border",
    "button-bg",
    "button-border",
    "button-hover",
    "button-active",
    "button-disabled-bg",
    "button-disabled-text",
    "primary",
    "primary-soft",
    "metric-cpu",
    "metric-memory",
    "metric-storage",
    "code-bg",
    "terminal-bg",
    "terminal-text",
    "overlay",
    "shadow-menu",
    "shadow-lg",
    "success-bg",
    "pending-bg",
    "pending-border",
    "pending-text",
    "warning-bg",
    "danger-bg",
    "error-bg",
    "scrollbar-track",
    "scrollbar-thumb",
    "primary-resize",
  ];
  for (const token of required) assert.match(tokens, new RegExp(`--${token}:`), `missing --${token}`);
  for (const theme of ["midnight", "nord", "forest", "plum", "mocha", "graphite", "light"]) {
    assert.match(tokens, new RegExp(`data-theme=["']${theme}["']`), `missing ${theme} selector`);
  }

  const blocks = [...tokens.matchAll(/([^{}]+)\{([^{}]+)\}/g)];
  const base = cssHexTokens(blocks.filter(([, selector]) => selector.includes(":root,") || selector.includes('data-theme="midnight"')));
  for (const theme of ["midnight", "nord", "forest", "plum", "mocha", "graphite", "light"]) {
    const palette = {
      ...base,
      ...cssHexTokens(blocks.filter(([, selector]) => selector.includes(`data-theme="${theme}"`))),
    };
    for (const [foreground, background] of [
      ["text", "app-bg"],
      ["text", "panel"],
      ["muted", "panel"],
    ]) {
      assert.ok(contrastRatio(palette[foreground], palette[background]) >= 4.5, `${theme} ${foreground}/${background} must meet WCAG AA`);
    }
    if (theme === "graphite") {
      assert.ok(contrastRatio(palette["text-inverse"], palette.primary) >= 4.5, "graphite primary button must meet WCAG AA");
      assert.ok(contrastRatio(palette["text-inverse"], palette["primary-hover"]) >= 4.5, "graphite primary hover must meet WCAG AA");
    }
  }
});

test("2.8.1 Kubernetes statuses distinguish pending from failure", () => {
  const model = loadTypeScript("utils/kubernetesStatusTone.ts");
  assert.equal(model.kubernetesStatusTone({ phase: "Running", ready: "1/1" }), "success");
  assert.equal(model.kubernetesStatusTone({ phase: "Running", ready: "0/1" }), "pending");
  assert.equal(model.kubernetesStatusTone({ phase: "Pending", reason: "ContainerCreating" }), "pending");
  assert.equal(model.kubernetesStatusTone({ phase: "Pending", reason: "ImagePullBackOff" }), "pending");
  assert.equal(model.kubernetesStatusTone({ phase: "Running", reason: "CrashLoopBackOff" }), "danger");
  assert.equal(model.isKubernetesFailure("ImagePullBackOff"), true);
  assert.equal(model.kubernetesStatusTone({ phase: "Succeeded" }), "success");
  assert.equal(model.kubernetesStatusTone({ phase: "SomethingNew" }), "neutral");
  assert.equal(model.kubernetesStatusTone({ phase: "Running", deletionTimestamp: "2026-07-27T00:00:00Z" }), "pending");

  const table = fs.readFileSync(path.join(rendererRoot, "components/ResourceTable.tsx"), "utf8");
  const summary = fs.readFileSync(path.join(rendererRoot, "components/ResourceSummary.tsx"), "utf8");
  const tableStyles = fs.readFileSync(path.join(rendererRoot, "styles/resource-table.css"), "utf8");
  const layoutStyles = fs.readFileSync(path.join(rendererRoot, "styles/layout.css"), "utf8");
  const formatCell = fs.readFileSync(path.join(rendererRoot, "components/resourceTable/formatCell.tsx"), "utf8");
  assert.match(formatCell, /kubernetesStatusTone\(row\)/);
  assert.match(summary, /kubernetesStatusTone\(row\)/);
  assert.doesNotMatch(table, /resource-row-warning|rowHealthClass/);
  assert.doesNotMatch(layoutStyles, /resource-row-warning/);
  // "Not ready" is a pod on its way up, not a pod that failed - the cube has to
  // read pending rather than red. This used to be asserted by grepping the
  // table's source; the function it lives in is importable now.
  const rowStatus = loadTypeScript("components/resourceTable/rowStatus.ts");
  assert.equal(rowStatus.containerTone("running", false, "not ready"), "waiting");
  assert.equal(rowStatus.containerTone("running", false, "Not Ready"), "waiting");
  assert.equal(rowStatus.containerTone("running", true, ""), "ready");
  assert.equal(rowStatus.containerTone("waiting", false, "ImagePullBackOff"), "danger");
  assert.equal(rowStatus.containerTone("running", false, ""), "running");
  assert.equal(rowStatus.containerTone("", false, ""), "unknown");
  assert.match(tableStyles, /\.resource-table th,\s*\.resource-table td\s*\{[^}]*padding:\s*3px 10px;[^}]*line-height:\s*1\.1;/s);
  assert.match(tableStyles, /\.resource-table tbody tr\s*\{[^}]*min-height:\s*28px;/s);
  assert.match(tableStyles, /\.resource-table \.select-col input\[type="checkbox"\]\s*\{[^}]*padding:\s*0;[^}]*border:\s*0;/s);
  assert.match(tableStyles, /\.table-footer\s*\{[^}]*border-top:\s*0;/s);
  assert.match(tableStyles, /\.phase-value\s*\{[^}]*font-weight:\s*650;/s);
  assert.match(tableStyles, /\.phase-value\.is-pending\s*\{[^}]*color:\s*var\(--pending-text\);/s);
  assert.doesNotMatch(tableStyles, /\.phase-value\.is-pending\s*\{[^}]*(?:background|border-color):/s);
});

// grep contract: asserts on source text, not behaviour.
test("resource pagination uses semantic button tokens for every state", () => {
  const component = fs.readFileSync(path.join(rendererRoot, "components/ResourceTablePagination.tsx"), "utf8");
  const styles = fs.readFileSync(path.join(rendererRoot, "styles/resource-table.css"), "utf8");
  assert.equal((component.match(/className="secondary-btn"/g) || []).length, 4);
  for (const state of ["secondary-btn {", ":hover:not(:disabled)", ":active:not(:disabled)", ":disabled"]) {
    assert.match(styles, new RegExp(`\\.pagination-actions[\\s\\S]*?${state.replace(/[()]/g, "\\$&")}`));
  }
  for (const token of ["--button-bg", "--button-border", "--button-hover", "--button-active", "--button-disabled-bg"]) {
    assert.match(styles, new RegExp(`var\\(${token}\\)`));
  }
});

// grep contract: asserts on source text, not behaviour.
test("the YAML editor is themed by the application palette rather than a bundled theme", () => {
  const editor = fs.readFileSync(path.join(rendererRoot, "components/YamlSourceEditor.tsx"), "utf8");
  const drawerStyles = fs.readFileSync(path.join(rendererRoot, "styles/drawer.css"), "utf8");

  // Themes are switched at runtime through CSS variables, so a theme built out
  // of literal colours would freeze the editor on whichever one was bundled.
  assert.doesNotMatch(editor, /@codemirror[/]theme-|oneDark/);
  const theme = editor.slice(editor.indexOf("const yamlEditorTheme"), editor.indexOf("const intelliJStyleKeymap"));
  assert.ok(theme.includes("var(--text)") && theme.includes("var(--focus-ring)"), "the editor theme reads the application palette");
  assert.doesNotMatch(theme, /#[0-9a-fA-F]{3}/, "no literal colours in the editor theme");

  // The host is the sized box and CodeMirror's scroller fills it, so the
  // hand-positioned fold gutter and highlight layer are gone with their rules.
  assert.match(drawerStyles, /[.]yaml-ide-editor [.]cm-editor \{\s*height: 100%;/);
  for (const dead of [/[.]yaml-fold-view/, /[.]yaml-segment-row/, /[.]yaml-highlight-layer/, /[.]yaml-editor-input/]) {
    assert.doesNotMatch(drawerStyles, dead);
  }
  // The token classes stay: the manifest diff still renders YAML lines as markup.
  assert.match(drawerStyles, /[.]yaml-key \{/);
});

// grep contract: asserts on source text, not behaviour.
test("every ANSI colour stays readable against its own terminal background", () => {
  const theme = fs.readFileSync(path.join(rendererRoot, "utils/terminalTheme.ts"), "utf8");
  const slots = [
    "black",
    "red",
    "green",
    "yellow",
    "blue",
    "magenta",
    "cyan",
    "white",
    "brightBlack",
    "brightRed",
    "brightGreen",
    "brightYellow",
    "brightBlue",
    "brightMagenta",
    "brightCyan",
    "brightWhite",
  ];

  // xterm fills anything left out from its own palette, which assumes a dark
  // background. Leaving the eight bright slots unset put #eeeeec on the light
  // theme's #f5f7fa background, so `top`, which prints its summary values in
  // bold white, rendered them invisible.
  for (const slot of slots) {
    assert.match(theme, new RegExp("\\b" + slot + ": token\\("), slot + " must be given to xterm explicitly");
  }

  const lines = fs.readFileSync(path.join(rendererRoot, "styles/tokens.css"), "utf8").split(String.fromCharCode(13)).join("").split(String.fromCharCode(10));
  const themes = {};
  let current = null;
  for (const line of lines) {
    if (line.endsWith("{")) {
      const named = line.match(/data-theme="([a-z]+)"/);
      current = named ? named[1] : line.startsWith(":root") ? "root" : null;
      if (current && !themes[current]) themes[current] = {};
      continue;
    }
    if (line.startsWith("}")) current = null;
    if (!current) continue;
    const declaration = line.match(/(--[a-z-]+):\s*([^;]+);/);
    if (declaration) themes[current][declaration[1]] = declaration[2].trim();
  }

  const luminance = (hex) => {
    const h = hex.replace("#", "");
    const channels = [0, 2, 4].map((i) => Number.parseInt(h.substr(i, 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  };
  const contrast = (a, b) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };

  const base = { ...themes.root, ...themes.midnight };
  const cssSlots = slots.map((slot) => "--terminal-" + slot.replace(/([A-Z])/g, (m) => "-" + m.toLowerCase()));

  for (const name of ["midnight", "graphite", "nord", "forest", "plum", "mocha", "light"]) {
    const resolved = { ...base, ...(themes[name] ?? {}) };
    const background = resolved["--terminal-bg"];
    assert.ok(background, name + " must define a terminal background");
    const dark = luminance(background) < 0.2;
    for (const slot of cssSlots) {
      const colour = resolved[slot];
      assert.ok(colour && colour.startsWith("#"), name + " is missing " + slot);
      // ANSI black is meant to sit near a dark background; that is the palette
      // working rather than a defect.
      if (dark && slot === "--terminal-black") continue;
      const ratio = contrast(colour, background);
      assert.ok(ratio >= 2, name + " " + slot + " " + colour + " is " + ratio.toFixed(2) + ":1 against " + background);
    }
  }
});
