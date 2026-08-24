// The size limits every interactive session is held to, in one place. Pod exec
// and Node SSH each carried their own copy, and the two had drifted: SSH
// defaulted to 30 rows with a floor of 8, pod exec to 24 with a floor of 5.
// Nothing in either module explained the difference and nothing depended on it,
// so both now use the pod terminal's numbers - 24 is the conventional terminal
// height, and the lower floor lets a panel dragged very small still report the
// size it actually shows instead of one the reader cannot see.
export const MAX_CLIENT_MESSAGE_BYTES = 256 * 1024;

export const DEFAULT_ROWS = 24;
export const DEFAULT_COLS = 100;
export const MIN_ROWS = 5;
export const MAX_ROWS = 200;
export const MIN_COLS = 20;
export const MAX_COLS = 500;
