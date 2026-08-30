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
const { readThemes, channels, contrast } = require("./helpers/contrast.cjs");

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

// White on the primary accent, re-measured 2026-08-30 after the five failing
// accents were darkened. Every theme now clears WCAG AA in both the idle and
// the hover state, so these floors sit just under the measurement and the
// ratchet holds the fix in place. See section B of docs/unseen-defects-plan.md.
const PRIMARY_BUTTON_FLOOR = {
  midnight: { primary: 5.5, "primary-hover": 4.6 },
  graphite: { primary: 5.55, "primary-hover": 4.6 },
  nord: { primary: 5.5, "primary-hover": 4.6 },
  forest: { primary: 5.5, "primary-hover": 4.6 },
  plum: { primary: 5.5, "primary-hover": 4.6 },
  mocha: { primary: 5.5, "primary-hover": 4.6 },
  light: { primary: 5.6, "primary-hover": 7.0 },
};

// Not a grep contract: the required tokens are read as declarations and the
// pairs below are measured. It shares helpers/contrast.cjs with the editor, the
// Related panel and the terminal palette, so the arithmetic lives in one place.
test("every color theme exposes the shared token contract", () => {
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

  const themes = readThemes();
  assert.ok(themes.size >= 7, `expected every theme to be read, got ${themes.size}`);

  for (const [name, palette] of themes) {
    for (const token of required) {
      const value = palette[`--${token}`];
      assert.ok(value, `${name} resolves no --${token}`);
    }

    // A theme is free to choose its colours; it is not free to make its own
    // text unreadable on its own surfaces.
    for (const [foreground, background] of [
      ["text", "app-bg"],
      ["text", "panel"],
      ["muted", "panel"],
    ]) {
      const ratio = contrast(channels(palette[`--${foreground}`]), channels(palette[`--${background}`]));
      assert.ok(ratio >= 4.5, `${name} ${foreground} on ${background} is ${ratio.toFixed(2)}:1, below WCAG AA`);
    }

    // A primary button is text on a filled accent, and it is the pairing these
    // themes used to get wrong: measured 2026-08-29, five of the seven put white
    // below WCAG AA on the button, the hover state worst. The accents were
    // darkened on 2026-08-30 - lightness only, so each theme keeps its hue - and
    // the floors moved up with them. The ratchet stays because a palette edit is
    // the easiest way to lose this again, but it now sits above 4.5 everywhere.
    for (const [surface, floor] of Object.entries(PRIMARY_BUTTON_FLOOR[name])) {
      const ratio = contrast(channels(palette["--text-inverse"]), channels(palette[`--${surface}`]));
      assert.ok(ratio >= floor, `${name} text-inverse on ${surface} fell to ${ratio.toFixed(2)}:1, below the ${floor} it held`);
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
// Stays one, and here is why. It is a list of CSS declarations - which token
// each button state paints with - and jsdom has no cascade to resolve them
// through. What can be measured about colour is measured in the test above and
// in helpers/contrast.cjs.
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
// Stays one, and here is why. Most of it is an absence: no bundled CodeMirror
// theme, no literal colours in the editor's own theme, no leftover rules for
// the hand-positioned gutter that CodeMirror replaced. An absence has nothing
// to render and nothing to click. What the editor's colours actually do to the
// text under them is checked in yaml-editor.contract.test.cjs, with arithmetic.
test("the YAML editor is themed by the application palette rather than a bundled theme", () => {
  const editor = fs.readFileSync(path.join(rendererRoot, "components/YamlSourceEditor.tsx"), "utf8");
  const drawerStyles = fs.readFileSync(path.join(rendererRoot, "styles/drawer.css"), "utf8");

  // Themes are switched at runtime through CSS variables, so a theme built out
  // of literal colours would freeze the editor on whichever one was bundled.
  assert.doesNotMatch(editor, /@codemirror[/]theme-|oneDark/);
  // Comments are stripped first: the point is that no colour is *declared*
  // literally, and a comment naming the colour CodeMirror's own base theme
  // ships is evidence rather than a violation.
  const theme = editor.slice(editor.indexOf("const yamlEditorTheme"), editor.indexOf("const intelliJStyleKeymap")).replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
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
