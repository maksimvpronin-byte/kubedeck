// The terminal palette, built from a real document with the real stylesheet.
//
// This replaces sixteen regular expressions of the form `\bred: token\(` over
// terminalTheme.ts. A slot appearing in the source is not the same as a slot
// arriving filled: the function reads custom properties out of a computed style,
// and a property the stylesheet never defines comes back empty and is replaced
// by a hard-coded fallback chosen for a dark background.
//
// That is the bug this guards. xterm fills anything left out from its own
// palette, which assumes dark; leaving the eight bright slots unset put a
// near-white on the light theme's near-white background, and `top` - which
// prints its summary values in bold, which xterm renders in the bright colour -
// came out invisible.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { loadComponent, React, window, rendererRoot } = require("./helpers/dom.cjs");
const { readThemes, channels, contrast } = require("./helpers/contrast.cjs");

const { terminalThemeFromCss } = loadComponent("utils/terminalTheme.ts", { "@xterm/xterm": {} });

// The real stylesheet, in the real document the function reads from.
const sheet = document.createElement("style");
sheet.textContent = fs.readFileSync(path.join(rendererRoot, "styles/tokens.css"), "utf8");
document.head.appendChild(sheet);

const THEMES = ["midnight", "graphite", "nord", "forest", "plum", "mocha", "light"];

// The sixteen ANSI slots, paired with the custom property each is read from.
const ANSI = [
  ["black", "--terminal-black"],
  ["red", "--terminal-red"],
  ["green", "--terminal-green"],
  ["yellow", "--terminal-yellow"],
  ["blue", "--terminal-blue"],
  ["magenta", "--terminal-magenta"],
  ["cyan", "--terminal-cyan"],
  ["white", "--terminal-white"],
  ["brightBlack", "--terminal-bright-black"],
  ["brightRed", "--terminal-bright-red"],
  ["brightGreen", "--terminal-bright-green"],
  ["brightYellow", "--terminal-bright-yellow"],
  ["brightBlue", "--terminal-bright-blue"],
  ["brightMagenta", "--terminal-bright-magenta"],
  ["brightCyan", "--terminal-bright-cyan"],
  ["brightWhite", "--terminal-bright-white"],
];

function themed(name) {
  document.documentElement.setAttribute("data-theme", name);
  return terminalThemeFromCss();
}

test("every ANSI slot arrives from the theme, in every theme", () => {
  // Not "the source mentions the slot" - the value handed to xterm is the value
  // the stylesheet defines, which is the only way a fallback cannot hide.
  const declared = readThemes();
  for (const name of THEMES) {
    const built = themed(name);
    const tokens = declared.get(name);
    for (const [slot, property] of ANSI) {
      assert.equal(built[slot], tokens[property], `${name}: ${slot} did not come from ${property}`);
    }
    assert.equal(built.background, tokens["--terminal-bg"]);
    assert.equal(built.foreground, tokens["--terminal-text"]);
  }
});

test("the light theme's bright colours are its own, not xterm's near-white", () => {
  // The regression in one assertion. Every bright slot on a light background
  // has to be dark enough to sit on it.
  const built = themed("light");
  const background = channels(built.background);
  for (const [slot] of ANSI.filter(([name]) => name.startsWith("bright"))) {
    const ratio = contrast(channels(built[slot]), background);
    assert.ok(ratio >= 2, `light: ${slot} ${built[slot]} is ${ratio.toFixed(2)}:1 against ${built.background}`);
  }
});

test("every colour keeps its distance from its own terminal background", () => {
  for (const name of THEMES) {
    const built = themed(name);
    const background = channels(built.background);
    const dark = contrast(background, [255, 255, 255]) > 4.5;
    for (const [slot] of ANSI) {
      // ANSI black is meant to sit near a dark background; that is the palette
      // working rather than a defect.
      if (dark && slot === "black") continue;
      const ratio = contrast(channels(built[slot]), background);
      assert.ok(ratio >= 2, `${name}: ${slot} ${built[slot]} is ${ratio.toFixed(2)}:1 against ${built.background}`);
    }
  }
});

test("the cursor and the selection are the theme's too", () => {
  // A computed value comes back with its whitespace normalised - `rgb(a b c/d)`
  // for the stylesheet's `rgb(a b c / d)` - so the comparison ignores spacing
  // rather than the difference being papered over on one side.
  const tidy = (value) => value.replace(/\s+/g, "");
  const declared = readThemes();
  for (const name of THEMES) {
    const built = themed(name);
    assert.equal(tidy(built.cursor), tidy(declared.get(name)["--terminal-cursor"]));
    assert.equal(tidy(built.selectionBackground), tidy(declared.get(name)["--terminal-selection"]));
  }
});

test("switching the theme rebuilds the palette rather than remembering the old one", () => {
  // The terminal is rebuilt on a theme change, so the function must read the
  // document each time rather than closing over what it found first.
  const first = themed("midnight");
  const second = themed("light");
  const back = themed("midnight");

  assert.notEqual(first.background, second.background);
  assert.equal(back.background, first.background);
  assert.equal(back.brightWhite, first.brightWhite);
});

test("a document with no palette at all still gets sixteen colours", () => {
  // The fallbacks are the last line rather than the first: if the stylesheet is
  // not there yet, xterm must still be handed a full palette rather than
  // sixteen empty strings.
  const bare = new (require("jsdom").JSDOM)("<!doctype html><html><body></body></html>");
  const realDocument = globalThis.document;
  const realGetComputedStyle = globalThis.getComputedStyle;
  globalThis.document = bare.window.document;
  globalThis.getComputedStyle = bare.window.getComputedStyle.bind(bare.window);
  try {
    const built = terminalThemeFromCss();
    for (const [slot] of ANSI) {
      assert.match(built[slot], /^#[0-9a-f]{6}$/i, `${slot} must have a fallback`);
    }
  } finally {
    globalThis.document = realDocument;
    globalThis.getComputedStyle = realGetComputedStyle;
  }
});

// React is imported by the harness; referencing it keeps the lint honest about
// why this file loads the DOM helper at all.
assert.ok(React, "the DOM harness installs the document this file reads from");
assert.ok(window, "and the window its computed styles come from");
