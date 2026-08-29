// Reading the theme palette and measuring what a background does to the text on
// top of it. Two contract tests need this: the manifest editor paints selections
// and search matches behind syntax-coloured text, and the Related panel paints a
// hover behind a card's own text. Both had the same defect - an accent laid on
// so thick that it took the words with it - and both are colour, so nothing but
// arithmetic can see it.
const fs = require("node:fs");
const path = require("node:path");

const tokensPath = path.resolve(__dirname, "../../src/renderer/styles/tokens.css");

// Every theme inherits from the first block and overrides part of it.
function readThemes() {
  const css = fs.readFileSync(tokensPath, "utf8");
  const themes = new Map();
  let base = null;
  for (const block of css.split(/\n(?=:root|\[data-theme)/)) {
    const name = block.split("{")[0].match(/data-theme="(\w+)"/)?.[1];
    if (!name) continue;
    const declared = Object.fromEntries([...block.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(([, key, value]) => [key, value.trim()]));
    base ??= declared;
    themes.set(name, { ...base, ...themes.get(name), ...declared });
  }
  return themes;
}

function channels(value) {
  const hex = value.trim().replace("#", "");
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex;
  if (!/^[0-9a-f]{6}$/i.test(full)) throw new Error(`${value} is not a hex colour`);
  return [0, 2, 4].map((at) => Number.parseInt(full.slice(at, at + 2), 16));
}

function luminance(rgb) {
  const [r, g, b] = rgb.map((c) => (c / 255 <= 0.04045 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// WCAG relative contrast, which is the only part of this that is a standard.
function contrast(a, b) {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}

// `color-mix(in srgb, colour N%, transparent)` composited over what is behind it.
function over(colour, background, alpha) {
  return colour.map((c, at) => Math.round(c * alpha + background[at] * (1 - alpha)));
}

// The rule both tests hold, in one place so it cannot drift between them. It is
// relative because a theme is free to choose quiet colours; what it may not do
// is let a background take them away.
const KEEPS_AT_LEAST = 0.45;
const NEVER_BELOW = 2.3;

function readabilityFailures({ background, over: painted, inks }) {
  const failures = [];
  for (const [name, ink] of Object.entries(inks)) {
    const bare = contrast(ink, background);
    const on = contrast(ink, painted);
    const kept = on / bare;
    if (kept < KEEPS_AT_LEAST) failures.push(`${name} keeps only ${(kept * 100).toFixed(0)}% of its contrast`);
    if (on < NEVER_BELOW) failures.push(`${name} falls to ${on.toFixed(2)}:1`);
  }
  return failures;
}

module.exports = { readThemes, channels, contrast, over, readabilityFailures, KEEPS_AT_LEAST, NEVER_BELOW };
