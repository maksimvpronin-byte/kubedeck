import type { CSSProperties } from "react";
import { ANSI_FALLBACKS } from "./terminalTheme";

// A log line as it is shown: its text with the escape sequences taken out, and
// the stretches of it the program asked to be coloured.
export interface AnsiRun {
  from: number;
  to: number;
  style: CSSProperties;
}

export interface AnsiLine {
  text: string;
  runs: AnsiRun[];
}

interface SgrState {
  fg?: string;
  bg?: string;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
  inverse?: boolean;
}

// CSI (colours, cursor moves, erases), OSC (titles, hyperlinks) and the
// two-character escapes. Only the colours mean anything in a log; the rest are
// dropped rather than shown as a box and a bracket.
const ESCAPE = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?|\x1b[@-Z\\-_]?/g;

// The same sixteen colours the pod terminal uses, so a log reads the same in
// both places and follows the theme.
const BASIC = ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white"];
function basicColor(index: number): string {
  const slot = index < 8 ? BASIC[index] : `bright-${BASIC[index % 8]}`;
  return `var(--terminal-${slot}, ${ANSI_FALLBACKS[slot]})`;
}

function paletteColor(index: number): string | undefined {
  if (!Number.isInteger(index) || index < 0 || index > 255) return undefined;
  if (index < 16) return basicColor(index);
  if (index < 232) {
    const cube = index - 16;
    const level = (value: number) => (value === 0 ? 0 : 55 + value * 40);
    return `rgb(${level(Math.floor(cube / 36))} ${level(Math.floor(cube / 6) % 6)} ${level(cube % 6)})`;
  }
  const gray = 8 + (index - 232) * 10;
  return `rgb(${gray} ${gray} ${gray})`;
}

// 38;5;n and 38;2;r;g;b, and their background twins. Returns the colour and
// how many parameters it used up after the 38 or 48.
function extendedColor(params: number[], at: number): [string | undefined, number] {
  if (params[at] === 5) return [paletteColor(params[at + 1]), 2];
  if (params[at] === 2) {
    const [r, g, b] = params.slice(at + 1, at + 4);
    const channel = (value: number) => Number.isInteger(value) && value >= 0 && value <= 255;
    return [channel(r) && channel(g) && channel(b) ? `rgb(${r} ${g} ${b})` : undefined, 4];
  }
  return [undefined, 0];
}

function applySgr(state: SgrState, body: string): SgrState {
  const params = body === "" ? [0] : body.split(/[;:]/).map((part) => (part === "" ? 0 : Number(part)));
  const next = { ...state };
  for (let i = 0; i < params.length; i += 1) {
    const code = params[i];
    if (code === 0) {
      for (const key of Object.keys(next) as Array<keyof SgrState>) delete next[key];
    } else if (code === 1) next.bold = true;
    else if (code === 2) next.dim = true;
    else if (code === 3) next.italic = true;
    else if (code === 4) next.underline = true;
    else if (code === 7) next.inverse = true;
    else if (code === 22) next.bold = next.dim = undefined;
    else if (code === 23) next.italic = undefined;
    else if (code === 24) next.underline = undefined;
    else if (code === 27) next.inverse = undefined;
    else if (code >= 30 && code <= 37) next.fg = basicColor(code - 30);
    else if (code === 39) next.fg = undefined;
    else if (code >= 40 && code <= 47) next.bg = basicColor(code - 40);
    else if (code === 49) next.bg = undefined;
    else if (code >= 90 && code <= 97) next.fg = basicColor(code - 90 + 8);
    else if (code >= 100 && code <= 107) next.bg = basicColor(code - 100 + 8);
    else if (code === 38 || code === 48) {
      const [color, used] = extendedColor(params, i + 1);
      if (code === 38) next.fg = color;
      else next.bg = color;
      i += used;
    }
  }
  return next;
}

function cssFor(state: SgrState): CSSProperties | null {
  let { fg, bg } = state;
  if (state.inverse) [fg, bg] = [bg ?? "var(--terminal-bg)", fg ?? "var(--text)"];
  const style: CSSProperties = {};
  if (fg) style.color = fg;
  if (bg) style.backgroundColor = bg;
  if (state.bold) style.fontWeight = 700;
  if (state.dim) style.opacity = 0.7;
  if (state.italic) style.fontStyle = "italic";
  if (state.underline) style.textDecoration = "underline";
  return Object.keys(style).length ? style : null;
}

export function stripAnsi(text: string): string {
  return text.includes("\x1b") ? text.replace(ESCAPE, "") : text;
}

// The colour a line leaves on carries into the next one, as it would in a
// terminal: a stack trace printed in red stays red to its last frame.
export function parseAnsiLines(lines: string[]): AnsiLine[] {
  let state: SgrState = {};
  return lines.map((raw) => {
    if (!raw.includes("\x1b")) {
      const style = cssFor(state);
      return { text: raw, runs: style && raw ? [{ from: 0, to: raw.length, style }] : [] };
    }
    let text = "";
    const runs: AnsiRun[] = [];
    const emit = (chunk: string) => {
      if (!chunk) return;
      const style = cssFor(state);
      if (style) runs.push({ from: text.length, to: text.length + chunk.length, style });
      text += chunk;
    };
    let cursor = 0;
    for (const match of raw.matchAll(ESCAPE)) {
      emit(raw.slice(cursor, match.index));
      cursor = match.index + match[0].length;
      const sgr = /^\x1b\[([0-9;:]*)m$/.exec(match[0]);
      if (sgr) state = applySgr(state, sgr[1]);
    }
    emit(raw.slice(cursor));
    return { text, runs };
  });
}
