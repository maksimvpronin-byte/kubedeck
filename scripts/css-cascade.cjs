#!/usr/bin/env node
// Cascade tooling for apps/desktop/src/renderer/styles.
//
// Written for section H of docs/file-structure-refactor-plan.md, which removes
// `!important` from a chain of rules that only needed it because the rule at the
// bottom of the chain had it. Two jobs:
//
//   report  - every `!important` in the folder, whether it is load-bearing, and
//             what it is beating. `--check` turns the same pass into a gate:
//             an `!important` on a selector below specificity 200 has to carry
//             a comment saying what it overrides.
//   diff    - which declaration wins, for every pair that can fight over one
//             element, compared against a saved snapshot. Section H changes the
//             cascade on purpose, so this is a change report to read, not a
//             pass/fail check.
//
// Usage:
//   node scripts/css-cascade.cjs report [--check]
//   node scripts/css-cascade.cjs snapshot <file>
//   node scripts/css-cascade.cjs diff <file>
const fs = require("node:fs");
const path = require("node:path");

const STYLES = path.join(__dirname, "..", "apps", "desktop", "src", "renderer", "styles");
const ENTRY = path.join(__dirname, "..", "apps", "desktop", "src", "renderer", "main.tsx");
const LOW_SPECIFICITY = 200;

// A ratchet, not a target. 114 of these live in drawer-controls.css and
// related-panel.css, which were written `!important`-first: inside them a weak
// rule routinely beats a strong one, so no single removal is safe and the two
// files need rewriting against the running application rather than analysing.
// Until someone does that, this holds the line: new ones are refused, and every
// removal should be followed by lowering the number.
const BUDGET = 114;

/** Import order is the cascade order, so it is read from the renderer entry. */
function styleOrder() {
  const source = fs.readFileSync(ENTRY, "utf8");
  return [...source.matchAll(/import "\.\/styles\/([\w.-]+\.css)";/g)].map((match) => match[1]);
}

// A comma inside :where(), :is() or :not() separates arguments, not selectors.
function splitSelectors(head) {
  const parts = [];
  let depth = 0;
  let current = "";
  for (const character of head) {
    if (character === "(") depth += 1;
    else if (character === ")") depth -= 1;
    if (character === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += character;
  }
  parts.push(current);
  return parts.map((part) => part.trim().replace(/\s+/g, " ")).filter(Boolean);
}

/** Blanks comments rather than dropping them, so offsets stay usable. */
function blankComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, (match) => " ".repeat(match.length));
}

function parse(text) {
  const source = blankComments(text);
  const rules = [];
  const atRules = [];
  let index = 0;
  let chunkStart = 0;
  while (index < source.length) {
    const character = source[index];
    if (character === "{") {
      const head = source.slice(chunkStart, index).trim();
      if (head.startsWith("@")) {
        atRules.push(head);
        chunkStart = index + 1;
        index += 1;
        continue;
      }
      let depth = 1;
      let end = index + 1;
      while (end < source.length && depth > 0) {
        if (source[end] === "{") depth += 1;
        else if (source[end] === "}") depth -= 1;
        end += 1;
      }
      const bodyStart = index + 1;
      const declarations = [];
      let cursor = bodyStart;
      for (const piece of source.slice(bodyStart, end - 1).split(";")) {
        const start = cursor;
        cursor += piece.length + 1;
        const colon = piece.indexOf(":");
        if (colon < 0) continue;
        const property = piece.slice(0, colon).trim();
        if (!property || property.startsWith("--")) continue;
        const bang = piece.search(/!\s*important/);
        declarations.push({ property, important: bang >= 0, offset: bang >= 0 ? start + bang : -1 });
      }
      const selectors = splitSelectors(head);
      if (selectors.length) rules.push({ selectors, declarations, atRules: [...atRules] });
      index = end;
      chunkStart = index;
      continue;
    }
    if (character === "}") {
      atRules.pop();
      index += 1;
      chunkStart = index;
      continue;
    }
    index += 1;
  }
  return rules;
}

/** Near enough for a class-driven stylesheet: ids, then classes, then elements. */
function specificity(selector) {
  const ids = (selector.match(/#[\w-]+/g) ?? []).length;
  const classes = (selector.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+/g) ?? []).length;
  const elements = (selector.match(/(^|[\s>+~])[a-zA-Z][\w-]*/g) ?? []).length;
  return ids * 10000 + classes * 100 + elements;
}

const classesOf = (selector) => new Set((selector.match(/\.[\w-]+/g) ?? []).map((name) => name.slice(1)));

/** Every declaration in the folder, in cascade order. */
function declarations() {
  const result = [];
  let position = 0;
  for (const file of styleOrder()) {
    const text = fs.readFileSync(path.join(STYLES, file), "utf8");
    const lines = blankComments(text).split("\n");
    const lineAt = (offset) => (offset < 0 ? 0 : text.slice(0, offset).split("\n").length);
    for (const rule of parse(text)) {
      for (const selector of rule.selectors) {
        for (const declaration of rule.declarations) {
          result.push({
            file,
            selector,
            property: declaration.property,
            important: declaration.important,
            line: lineAt(declaration.offset),
            specificity: specificity(selector),
            classes: classesOf(selector),
            position: position++,
            offsetKey: declaration.offset,
            loadBearing: false,
            lines,
          });
        }
      }
    }
  }
  return result;
}

/**
 * The compound the selector is actually about - what comes after the last
 * combinator. `.drawer button.primary:hover` is about a `button.primary`, not
 * about the drawer.
 */
function subjectOf(selector) {
  const last =
    selector
      .split(/\s+|\s*>\s*|\s*\+\s*|\s*~\s*/)
      .filter(Boolean)
      .at(-1) ?? selector;
  return {
    classes: new Set((last.match(/\.[\w-]+/g) ?? []).map((name) => name.slice(1))),
    element: last.match(/^[a-zA-Z][\w-]*/)?.[0] ?? "",
  };
}

/**
 * A rival sets the same property on an element this one could also hit.
 *
 * Sharing any class is too loose: in a stylesheet where everything sits under
 * one container class, `.terminal-toolbar button.primary` and
 * `.terminal-toolbar .themed-select-option` would count as rivals although no
 * element is ever both. Comparing the subjects instead - and only calling it a
 * rival when the subjects overlap, or when one is unqualified and so could be
 * anything - cuts the false pairs out. It is still a proxy: only the DOM knows
 * for certain, which is why the manual pass exists.
 */
function rivalsOf(declaration, byProperty) {
  const mine = subjectOf(declaration.selector);
  const rivals = [];
  for (const other of byProperty.get(declaration.property) ?? []) {
    if (other === declaration || other.selector === declaration.selector) continue;
    let sharesAncestor = false;
    for (const name of other.classes) {
      if (declaration.classes.has(name)) {
        sharesAncestor = true;
        break;
      }
    }
    if (!sharesAncestor) continue;
    const theirs = subjectOf(other.selector);
    if (mine.element && theirs.element && mine.element !== theirs.element) continue;
    const overlap = [...theirs.classes].some((name) => mine.classes.has(name));
    const unqualified = mine.classes.size === 0 || theirs.classes.size === 0;
    if (overlap || unqualified) rivals.push(other);
  }
  return rivals;
}

const outranks = (left, right) => (left.specificity !== right.specificity ? left.specificity > right.specificity : left.position > right.position);

function groupByProperty(all) {
  const byProperty = new Map();
  for (const declaration of all) {
    if (!byProperty.has(declaration.property)) byProperty.set(declaration.property, []);
    byProperty.get(declaration.property).push(declaration);
  }
  return byProperty;
}

function report(check) {
  const all = declarations();
  const byProperty = groupByProperty(all);
  const importants = all.filter((declaration) => declaration.important);
  const perFile = new Map();
  const undocumented = [];

  for (const declaration of importants) {
    let blocker = null;
    for (const rival of rivalsOf(declaration, byProperty)) {
      if (rival.important) {
        if (outranks(declaration, rival)) {
          blocker = `${rival.file}: ${rival.selector} (!important)`;
          break;
        }
      } else if (!outranks(declaration, rival)) {
        blocker = `${rival.file}: ${rival.selector}`;
        break;
      }
    }
    declaration.loadBearing = Boolean(blocker);
    const entry = perFile.get(declaration.file) ?? { total: 0, loadBearing: 0, notes: [] };
    entry.total += 1;
    if (blocker) {
      entry.loadBearing += 1;
      entry.notes.push(`${declaration.selector} { ${declaration.property} } <- ${blocker}`);
    }
    perFile.set(declaration.file, entry);

    // A low-specificity `!important` is the one that starts an arms race, so it
    // has to say what it is for.
    if (declaration.specificity < LOW_SPECIFICITY) {
      const above = declaration.lines
        .slice(Math.max(0, declaration.line - 6), declaration.line)
        .join("\n")
        .includes("/*");
      if (!above) undocumented.push(`${declaration.file}:${declaration.line} ${declaration.selector} { ${declaration.property} } (specificity ${declaration.specificity})`);
    }
  }

  // A rule with five selectors carries one `!important` in the source but five
  // declarations in the model above, so the count is per source offset.
  const written = new Map();
  for (const declaration of importants) {
    const key = `${declaration.file}|${declaration.offsetKey}`;
    if (!written.has(key)) written.set(key, { file: declaration.file, loadBearing: false });
    if (declaration.loadBearing) written.get(key).loadBearing = true;
  }
  const perFileWritten = new Map();
  for (const entry of written.values()) {
    const current = perFileWritten.get(entry.file) ?? { total: 0, loadBearing: 0 };
    current.total += 1;
    if (entry.loadBearing) current.loadBearing += 1;
    perFileWritten.set(entry.file, current);
  }
  console.log(`!important as written: ${written.size}`);
  for (const [file, entry] of [...perFileWritten.entries()].sort((a, b) => b[1].total - a[1].total)) {
    console.log(`  ${file.padEnd(28)} ${String(entry.total).padStart(4)} total, ${String(entry.loadBearing).padStart(4)} load-bearing`);
  }
  if (process.argv.includes("--why")) {
    for (const entry of perFile.values()) for (const note of [...new Set(entry.notes)]) console.log(`    keep: ${note}`);
  }

  if (!check) return 0;
  console.log(`\nlow-specificity (<${LOW_SPECIFICITY}) !important without a nearby comment: ${undocumented.length} (budget ${BUDGET})`);
  if (undocumented.length > BUDGET) {
    for (const line of undocumented) console.log(`  ${line}`);
    console.log(`\nOver budget by ${undocumented.length - BUDGET}. An !important on a selector this weak is what starts`);
    console.log("an arms race: everything more specific then needs one too. Either raise the");
    console.log("selector's specificity, or say above it what it overrides and why.");
    return 1;
  }
  if (undocumented.length < BUDGET) {
    console.log(`\nUnder budget. Lower BUDGET in ${path.basename(__filename)} to ${undocumented.length} to hold the ground.`);
  }
  return 0;
}

/** Removes every  the report found nothing for. Iterative: each
 *  pass can make the next layer down dead too. */
function strip() {
  const all = declarations();
  const byProperty = groupByProperty(all);
  const keep = new Map();
  for (const declaration of all) {
    if (!declaration.important) continue;
    let loadBearing = false;
    for (const rival of rivalsOf(declaration, byProperty)) {
      if (rival.important ? outranks(declaration, rival) : !outranks(declaration, rival)) {
        loadBearing = true;
        break;
      }
    }
    const key = `${declaration.file}|${declaration.offsetKey}`;
    keep.set(key, (keep.get(key) ?? false) || loadBearing);
  }
  let removed = 0;
  for (const file of styleOrder()) {
    const full = path.join(STYLES, file);
    const text = fs.readFileSync(full, "utf8");
    const cuts = [];
    for (const rule of parse(text)) {
      for (const declaration of rule.declarations) {
        if (!declaration.important) continue;
        if (keep.get(`${file}|${declaration.offset}`)) continue;
        const match = text.slice(declaration.offset).match(/^!\s*important/);
        if (match) cuts.push([declaration.offset, declaration.offset + match[0].length]);
      }
    }
    if (!cuts.length) continue;
    cuts.sort((a, b) => a[0] - b[0]);
    let out = "";
    let cursor = 0;
    for (const [start, end] of cuts) {
      let from = start;
      while (from > 0 && /[ 	]/.test(text[from - 1])) from -= 1;
      out += text.slice(cursor, from);
      cursor = end;
      removed += 1;
    }
    out += text.slice(cursor);
    fs.writeFileSync(full, out);
  }
  console.log(`removed ${removed}`);
  return removed;
}

/** Who wins, for every pair of declarations that can fight over one element. */
function winners() {
  const all = declarations();
  const byProperty = groupByProperty(all);
  const result = new Map();
  for (const group of byProperty.values()) {
    for (let i = 0; i < group.length; i += 1) {
      for (let j = i + 1; j < group.length; j += 1) {
        const left = group[i];
        const right = group[j];
        if (left.selector === right.selector) continue;
        let shared = false;
        for (const name of left.classes) {
          if (right.classes.has(name)) {
            shared = true;
            break;
          }
        }
        if (!shared) continue;
        const key = left.selector < right.selector ? `${left.selector} ~ ${right.selector} | ${left.property}` : `${right.selector} ~ ${left.selector} | ${left.property}`;
        let winner;
        if (left.important !== right.important) winner = left.important ? left : right;
        else winner = outranks(left, right) ? left : right;
        result.set(key, winner.selector);
      }
    }
  }
  return result;
}

const [command, file] = process.argv.slice(2);
if (command === "report") {
  process.exit(report(process.argv.includes("--check")));
} else if (command === "strip") {
  strip();
} else if (command === "snapshot") {
  const map = winners();
  fs.writeFileSync(file, JSON.stringify(Object.fromEntries(map), null, 0));
  console.log(`snapshot: ${map.size} competing pairs -> ${file}`);
} else if (command === "diff") {
  const before = new Map(Object.entries(JSON.parse(fs.readFileSync(file, "utf8"))));
  const after = winners();
  const flipped = [];
  const gone = [];
  for (const [pair, winner] of before) {
    if (!after.has(pair)) gone.push(pair);
    else if (after.get(pair) !== winner) flipped.push(`${pair}: ${winner} -> ${after.get(pair)}`);
  }
  const added = [...after.keys()].filter((pair) => !before.has(pair));
  console.log(`pairs before ${before.size}, after ${after.size}`);
  console.log(`flipped ${flipped.length}, gone ${gone.length}, new ${added.length}`);
  for (const line of flipped) console.log(`  FLIP  ${line}`);
  for (const line of gone.slice(0, 40)) console.log(`  GONE  ${line}`);
} else {
  console.error("usage: css-cascade.cjs report [--check|--why] | snapshot <file> | diff <file>");
  process.exit(2);
}
