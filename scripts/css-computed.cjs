#!/usr/bin/env node
// What every selector in the stylesheets resolves to, in every theme.
//
// Written for section C of docs/unseen-defects-plan.md. `css-cascade.cjs`
// answers which rule beats which - a question about the stylesheets. This
// answers what an element ends up with, which is what has to stay the same when
// an `!important` is taken out.
//
// The comment in css-cascade.cjs says drawer-controls.css and related-panel.css
// "need rewriting against the running application rather than analysing". This
// is most of the way there without the application: jsdom resolves selector
// matching, specificity and `!important` the way a browser does.
//
// What jsdom does NOT do, and this works around: it does not substitute `var()`
// in ordinary properties and does not expand shorthands. So properties are read
// as authored - `background`, not `background-color` - and the custom properties
// are substituted here, per theme, from tokens.css.
//
// That is the whole trick, and it is also the limit: this compares declared
// values after the cascade and after variable substitution. It does not lay
// anything out, so it cannot see a rule that changes size or position, and it
// cannot hover, so `:hover` rules are compared as their base element.
//
// Usage:
//   node scripts/css-computed.cjs snapshot <file>
//   node scripts/css-computed.cjs diff <file>
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const STYLES = path.join(__dirname, "..", "apps", "desktop", "src", "renderer", "styles");
const ENTRY = path.join(__dirname, "..", "apps", "desktop", "src", "renderer", "main.tsx");

const THEMES = ["default", "light", "midnight", "graphite", "nord", "forest", "plum", "mocha"];

// Read as authored, because that is what jsdom keeps.
const PROPERTIES = [
  // Colour and box
  "background",
  "background-color",
  "color",
  "border",
  "border-color",
  "border-top",
  "border-bottom",
  "border-radius",
  "box-shadow",
  "outline",
  // Text
  "font-weight",
  "font-size",
  "line-height",
  "text-decoration",
  "text-transform",
  "letter-spacing",
  "white-space",
  // Box model and layout, because a cascade flip on padding moves a button
  "padding",
  "margin",
  "width",
  "min-width",
  "max-width",
  "height",
  "min-height",
  "gap",
  "flex",
  // Behaviour a person notices
  "opacity",
  "display",
  "visibility",
  "transition",
  "transform",
  "cursor",
  "pointer-events",
];

function styleOrder() {
  const source = fs.readFileSync(ENTRY, "utf8");
  return [...source.matchAll(/import "\.\/styles\/([\w.-]+\.css)";/g)].map((match) => match[1]);
}

/** Every theme's palette, with each theme inheriting the first block. */
function palettes(css) {
  const result = new Map();
  let base = null;
  for (const block of css.split(/\n(?=:root|\[data-theme)/)) {
    const name = block.split("{")[0].match(/data-theme="(\w+)"/)?.[1];
    if (!name) continue;
    const declared = Object.fromEntries([...block.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(([, key, value]) => [key, value.trim()]));
    base ??= declared;
    result.set(name, { ...base, ...result.get(name), ...declared });
  }
  result.set("default", base);
  return result;
}

/** `var(--a, var(--b, red))` resolved against one theme, to a fixed point. */
function substitute(value, palette) {
  let current = String(value);
  for (let pass = 0; pass < 8 && current.includes("var("); pass += 1) {
    current = current.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*(?:\([^()]*\)[^()]*)*))?\)/g, (whole, token, fallback) => palette[token] ?? (fallback !== undefined ? fallback.trim() : whole));
  }
  return current;
}

function selectors(css) {
  const found = new Set();
  // Comments first: a rule head is whatever precedes a brace, and a comment
  // containing one would otherwise be read as a selector.
  css = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const match of css.matchAll(/(^|[}])\s*([^{}@]+?)\s*\{/g)) {
    for (const part of match[2].split(",")) {
      const selector = part.trim().replace(/\s+/g, " ");
      if (!selector || selector.startsWith("@") || selector.includes("%") || selector.includes("--")) continue;
      found.add(selector);
    }
  }
  return [...found];
}

// The shallowest DOM that matches a selector. Descendant steps become nested
// elements; state pseudo-classes are dropped, since jsdom cannot hover, so a
// `:hover` rule is probed as its base element.
function build(document, selector) {
  const steps = selector.split(/\s*>\s*|\s+/).filter(Boolean);
  let parent = document.body;
  let element = null;
  for (const step of steps) {
    const bare = step.replace(/::?[a-z-]+(\([^)]*\))?/g, "");
    if (!bare || bare === ":root") continue;
    const tag = bare.match(/^[a-zA-Z][\w-]*/)?.[0] ?? "div";
    element = document.createElement(tag);
    for (const cls of bare.matchAll(/\.([\w-]+)/g)) element.classList.add(cls[1]);
    for (const attribute of bare.matchAll(/\[([\w-]+)(?:[~|^$*]?=["']?([^\]"']*)["']?)?\]/g)) element.setAttribute(attribute[1], attribute[2] ?? "");
    parent.appendChild(element);
    parent = element;
  }
  return element;
}

function resolved() {
  const order = styleOrder();
  const css = order.map((file) => fs.readFileSync(path.join(STYLES, file), "utf8")).join("\n");
  const themePalettes = palettes(fs.readFileSync(path.join(STYLES, "tokens.css"), "utf8"));

  const dom = new JSDOM("<!doctype html><html><head></head><body></body></html>");
  const { document, getComputedStyle } = dom.window;
  const sheet = document.createElement("style");
  sheet.textContent = css;
  document.head.appendChild(sheet);

  const probes = [];
  for (const selector of selectors(css)) {
    const element = build(document, selector);
    if (element) probes.push({ selector, element });
  }

  const snapshot = {};
  for (const theme of THEMES) {
    if (theme === "default") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", theme);
    const palette = themePalettes.get(theme) ?? themePalettes.get("default");
    for (const { selector, element } of probes) {
      const style = getComputedStyle(element);
      const values = PROPERTIES.map((property) => substitute(style.getPropertyValue(property), palette)).join(" | ");
      snapshot[`${theme} ${selector}`] = values;
    }
  }
  return snapshot;
}

// Required as a module, this exports the one function worth reusing: a sweep
// that decides declaration by declaration needs it in-process, because spawning
// a process per candidate does not finish.
module.exports = { resolved };

function cli() {
  const [, , command, file] = process.argv;

  if (command === "snapshot") {
    if (!file) {
      console.error("usage: css-computed.cjs snapshot <file>");
      process.exit(2);
    }
    const snapshot = resolved();
    fs.writeFileSync(file, JSON.stringify(snapshot, null, 0));
    console.log(`${Object.keys(snapshot).length} resolved values written to ${file}`);
    process.exit(0);
  }

  if (command === "diff") {
    if (!file || !fs.existsSync(file)) {
      console.error("usage: css-computed.cjs diff <file made by snapshot>");
      process.exit(2);
    }
    const before = JSON.parse(fs.readFileSync(file, "utf8"));
    const after = resolved();
    const changed = [];
    for (const [key, value] of Object.entries(before)) {
      if (key in after && after[key] !== value) changed.push({ key, before: value, after: after[key] });
    }
    const gone = Object.keys(before).filter((key) => !(key in after));
    const added = Object.keys(after).filter((key) => !(key in before));

    console.log(`compared ${Object.keys(before).length} resolved values`);
    console.log(`  changed: ${changed.length}`);
    console.log(`  selectors gone: ${gone.length}`);
    console.log(`  selectors new: ${added.length}`);
    for (const entry of changed.slice(0, 40)) {
      console.log(`\n  ${entry.key}`);
      console.log(`    before ${entry.before}`);
      console.log(`    after  ${entry.after}`);
    }
    if (changed.length > 40) console.log(`\n  ...and ${changed.length - 40} more`);
    for (const key of gone.slice(0, 10)) console.log(`  gone: ${key}`);
    process.exit(changed.length === 0 ? 0 : 1);
  }

  console.error("usage: css-computed.cjs snapshot|diff <file>");
  process.exit(2);
}

if (require.main === module) cli();
