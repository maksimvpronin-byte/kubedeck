import type { FitAddon } from "@xterm/addon-fit";
import type { Terminal as XTerm } from "@xterm/xterm";

export type TerminalSize = { cols: number; rows: number };

export function disconnectTerminal(socketRef: { current: WebSocket | null }, setConnected: (value: boolean) => void, setStatus: (value: string) => void, setConnecting?: (value: boolean) => void) {
  const socket = socketRef.current;
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: "close" }));
    socket.close();
  } else if (socket) {
    socket.close();
  }
  socketRef.current = null;
  setConnected(false);
  setConnecting?.(false);
  setStatus("Disconnected");
}

export function terminalStatusClass(status: string, connected: boolean, connecting: boolean) {
  if (connected) return "terminal-status connected";
  if (connecting) return "terminal-status connecting";
  if (/error/i.test(status)) return "terminal-status error";
  return "terminal-status";
}

export function sendTerminalResizeIfChanged(socket: WebSocket | null, terminal: XTerm, lastSizeRef: { current: TerminalSize | null }) {
  if (socket?.readyState !== WebSocket.OPEN) return;
  const cols = terminal.cols;
  const rows = terminal.rows;
  if (!Number.isFinite(cols) || !Number.isFinite(rows) || cols <= 0 || rows <= 0) return;
  const lastSize = lastSizeRef.current;
  if (lastSize && lastSize.cols === cols && lastSize.rows === rows) return;
  lastSizeRef.current = { cols, rows };
  socket.send(JSON.stringify({ type: "resize", cols, rows }));
}

export function fitAndResizeTerminal(fit: FitAddon, socket: WebSocket | null, terminal: XTerm, lastSizeRef: { current: TerminalSize | null }) {
  try {
    fit.fit();
    sendTerminalResizeIfChanged(socket, terminal, lastSizeRef);
  } catch {
    // xterm can briefly report an invalid viewport while its panel is resizing/closing.
  }
}

export function copyTerminalSelection(terminal: XTerm | null, lastCopiedRef?: { current: string }, force = false) {
  const selection = terminal?.getSelection();
  if (!selection || (!force && selection === lastCopiedRef?.current)) return;
  if (lastCopiedRef) lastCopiedRef.current = selection;
  navigator.clipboard?.writeText(selection).catch(() => undefined);
}
