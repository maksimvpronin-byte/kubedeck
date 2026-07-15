import type { ITheme } from "@xterm/xterm";

function token(styles: CSSStyleDeclaration, name: string, fallback: string): string {
  return styles.getPropertyValue(name).trim() || fallback;
}

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
  };
}
