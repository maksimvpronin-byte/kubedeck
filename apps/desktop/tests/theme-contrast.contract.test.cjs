// Every surface that puts a colour on another colour, measured.
//
// Section B of docs/unseen-defects-plan.md. Three defects this week were a
// colour laid over text until the text went away, and each was found by
// arithmetic after the fact. This is the arithmetic run up front, over the
// surfaces the plan lists: status badges, focus rings, disabled controls, the
// terminal selection, table rows, and the accent where it is used as text.
//
// Two standards apply, and which one applies is a judgement rather than a
// measurement, so it is written down per surface rather than inferred:
//
//   - text on a background: WCAG AA, 4.5:1.
//   - a non-text part of the interface - a focus ring, an icon: 3:1, which is
//     what WCAG asks of user interface components.
//
// A disabled control is exempt from both by WCAG, deliberately: looking
// unavailable is the whole point of it. Exempt is not the same as unbounded, so
// those are held by a floor at what they measure rather than by a standard.
const test = require("node:test");
const assert = require("node:assert/strict");
const { readThemes, channels, contrast } = require("./helpers/contrast.cjs");

const themes = readThemes();

function ratio(theme, foreground, background) {
  const palette = themes.get(theme);
  assert.ok(palette[foreground], `${theme} resolves no ${foreground}`);
  assert.ok(palette[background], `${theme} resolves no ${background}`);
  return contrast(channels(palette[foreground]), channels(palette[background]));
}

// `rgb(r g b / a)` composited over what is behind it. The terminal selection is
// the only token in the palette written this way.
function blended(theme, token, behind) {
  const palette = themes.get(theme);
  const match = String(palette[token]).match(/rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)\s*[/,]?\s*([\d.]+)?\s*\)/);
  assert.ok(match, `${theme}: ${token} is expected to be an rgb() with an alpha`);
  const alpha = match[4] === undefined ? 1 : Number(match[4]);
  const base = channels(palette[behind]);
  return [1, 2, 3].map((index) => Math.round(Number(match[index]) * alpha + base[index - 1] * (1 - alpha)));
}

const EVERY_THEME = [...themes.keys()];

test("a status badge's own text is readable on its own background", () => {
  // These are read at a glance and often carry the only word explaining why a
  // row is not green, so they are held to the text standard.
  for (const theme of EVERY_THEME) {
    for (const kind of ["success", "warning", "danger"]) {
      const measured = ratio(theme, `--${kind}-text`, `--${kind}-bg`);
      assert.ok(measured >= 4.5, `${theme}: ${kind} badge is ${measured.toFixed(2)}:1`);
    }
  }
});

test("a focus ring can be seen against every surface it is drawn on", () => {
  // A ring is not text: 3:1 is the standard, and the light theme sits at 3.93
  // where the dark themes are above 6. That is the accent being dark on a light
  // background rather than a defect, but it is the one worth watching.
  for (const theme of EVERY_THEME) {
    for (const surface of ["--panel", "--surface", "--input-bg", "--app-bg"]) {
      const measured = ratio(theme, "--focus-ring", surface);
      assert.ok(measured >= 3, `${theme}: the focus ring is ${measured.toFixed(2)}:1 against ${surface}`);
    }
  }
});

test("a selected row and a hovered row still read as rows", () => {
  for (const theme of EVERY_THEME) {
    for (const surface of ["--surface-hover", "--surface-selected", "--surface-active"]) {
      const measured = ratio(theme, "--text", surface);
      assert.ok(measured >= 4.5, `${theme}: text on ${surface} is ${measured.toFixed(2)}:1`);
    }
    // Secondary text on a selected row is the tightest of these, and the light
    // theme is the one to watch at 4.21.
    const secondary = ratio(theme, "--muted", "--surface-selected");
    assert.ok(secondary >= 4.2, `${theme}: muted text on a selected row is ${secondary.toFixed(2)}:1`);
  }
});

test("a terminal selection does not swallow the text it covers", () => {
  // The same defect as the editor's selection, in the other place a selection is
  // painted. This one is an rgb() with an alpha over the terminal background.
  for (const theme of EVERY_THEME) {
    const selection = blended(theme, "--terminal-selection", "--terminal-bg");
    const measured = contrast(channels(themes.get(theme)["--terminal-text"]), selection);
    assert.ok(measured >= 4.5, `${theme}: terminal text on a selection is ${measured.toFixed(2)}:1`);
  }
});

// WCAG exempts disabled controls, and looking unavailable is what they are for.
// The floor is therefore what each theme measures today rather than a standard:
// it may not drift further into unreadable while nobody is looking.
const DISABLED_FLOOR = {
  midnight: 3.55,
  graphite: 3.8,
  nord: 3.5,
  forest: 3.55,
  plum: 3.2,
  mocha: 3.3,
  light: 2.6,
};

test("a disabled control stays as legible as it is today", () => {
  for (const theme of EVERY_THEME) {
    const measured = ratio(theme, "--button-disabled-text", "--button-disabled-bg");
    assert.ok(measured >= DISABLED_FLOOR[theme], `${theme}: a disabled button fell to ${measured.toFixed(2)}:1, below the ${DISABLED_FLOOR[theme]} it held`);
  }
});

// The accent is used as a text colour in five places - the `+N` node-label chip,
// the control-plane role chip, the `is-info` workload condition, a code span in
// the Related panel, and the tick in a themed select. On `--panel` it sits far
// below the text standard in every dark theme, and 2.23.6 made it slightly worse
// by darkening the accent so white on the primary button could be read.
//
// One token cannot do both jobs: a filled button wants an accent dark enough for
// white text, and a chip wants one light enough to read on a panel. Splitting
// them is a palette change and belongs to whoever owns the palette - open in
// section B of docs/unseen-defects-plan.md. Until then this holds the line.
const ACCENT_AS_TEXT_FLOOR = {
  midnight: 2.55,
  graphite: 2.45,
  nord: 2.1,
  forest: 2.35,
  plum: 2.4,
  mocha: 2.3,
  light: 5.6,
};

test("the accent used as text does not get fainter than it already is", () => {
  for (const theme of EVERY_THEME) {
    const measured = ratio(theme, "--primary", "--panel");
    assert.ok(measured >= ACCENT_AS_TEXT_FLOOR[theme], `${theme}: the accent as text fell to ${measured.toFixed(2)}:1, below the ${ACCENT_AS_TEXT_FLOOR[theme]} it held`);
  }
});
