import type { ITheme } from "@xterm/xterm";

// What a theme that leaves an ANSI slot out falls back to. The log viewer
// colours with the same tokens and the same fallbacks.
export const ANSI_FALLBACKS: Record<string, string> = {
  black: "#18212b",
  red: "#d98787",
  green: "#86c59d",
  yellow: "#d5b978",
  blue: "#77a9d1",
  magenta: "#b99acb",
  cyan: "#70b8bc",
  white: "#e8eef5",
  "bright-black": "#46586b",
  "bright-red": "#eda0a0",
  "bright-green": "#a2dbb6",
  "bright-yellow": "#ecd294",
  "bright-blue": "#9cc4e6",
  "bright-magenta": "#d0b4e0",
  "bright-cyan": "#8fd3d7",
  "bright-white": "#ffffff",
};

function token(styles: CSSStyleDeclaration, name: string, fallback: string): string {
  return styles.getPropertyValue(name).trim() || fallback;
}

// All sixteen ANSI slots have to be filled. xterm falls back to its own palette
// for anything left out, and that palette assumes a dark background: on the
// light theme the eight bright colours stayed near-white. `top` prints its
// summary values in bold white, xterm renders bold in the bright colour, and
// the numbers came out invisible against the background.
export function terminalThemeFromCss(): ITheme {
  const styles = getComputedStyle(document.documentElement);
  return {
    background: token(styles, "--terminal-bg", "#101820"),
    foreground: token(styles, "--terminal-text", "#dbe5ef"),
    cursor: token(styles, "--terminal-cursor", "#70b5d6"),
    selectionBackground: token(styles, "--terminal-selection", "rgb(77 148 183 / 0.34)"),
    black: token(styles, "--terminal-black", ANSI_FALLBACKS["black"]),
    blue: token(styles, "--terminal-blue", ANSI_FALLBACKS["blue"]),
    cyan: token(styles, "--terminal-cyan", ANSI_FALLBACKS["cyan"]),
    green: token(styles, "--terminal-green", ANSI_FALLBACKS["green"]),
    magenta: token(styles, "--terminal-magenta", ANSI_FALLBACKS["magenta"]),
    red: token(styles, "--terminal-red", ANSI_FALLBACKS["red"]),
    white: token(styles, "--terminal-white", ANSI_FALLBACKS["white"]),
    yellow: token(styles, "--terminal-yellow", ANSI_FALLBACKS["yellow"]),
    brightBlack: token(styles, "--terminal-bright-black", ANSI_FALLBACKS["bright-black"]),
    brightBlue: token(styles, "--terminal-bright-blue", ANSI_FALLBACKS["bright-blue"]),
    brightCyan: token(styles, "--terminal-bright-cyan", ANSI_FALLBACKS["bright-cyan"]),
    brightGreen: token(styles, "--terminal-bright-green", ANSI_FALLBACKS["bright-green"]),
    brightMagenta: token(styles, "--terminal-bright-magenta", ANSI_FALLBACKS["bright-magenta"]),
    brightRed: token(styles, "--terminal-bright-red", ANSI_FALLBACKS["bright-red"]),
    brightWhite: token(styles, "--terminal-bright-white", ANSI_FALLBACKS["bright-white"]),
    brightYellow: token(styles, "--terminal-bright-yellow", ANSI_FALLBACKS["bright-yellow"]),
  };
}
