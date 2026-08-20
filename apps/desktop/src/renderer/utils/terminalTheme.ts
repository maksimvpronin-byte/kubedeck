import type { ITheme } from "@xterm/xterm";

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
    black: token(styles, "--terminal-black", "#18212b"),
    blue: token(styles, "--terminal-blue", "#77a9d1"),
    cyan: token(styles, "--terminal-cyan", "#70b8bc"),
    green: token(styles, "--terminal-green", "#86c59d"),
    magenta: token(styles, "--terminal-magenta", "#b99acb"),
    red: token(styles, "--terminal-red", "#d98787"),
    white: token(styles, "--terminal-white", "#e8eef5"),
    yellow: token(styles, "--terminal-yellow", "#d5b978"),
    brightBlack: token(styles, "--terminal-bright-black", "#46586b"),
    brightBlue: token(styles, "--terminal-bright-blue", "#9cc4e6"),
    brightCyan: token(styles, "--terminal-bright-cyan", "#8fd3d7"),
    brightGreen: token(styles, "--terminal-bright-green", "#a2dbb6"),
    brightMagenta: token(styles, "--terminal-bright-magenta", "#d0b4e0"),
    brightRed: token(styles, "--terminal-bright-red", "#eda0a0"),
    brightWhite: token(styles, "--terminal-bright-white", "#ffffff"),
    brightYellow: token(styles, "--terminal-bright-yellow", "#ecd294"),
  };
}
