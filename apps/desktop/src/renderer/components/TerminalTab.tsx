import { useEffect, useRef, useState } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal as XTerm } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import type { ApiClient } from "../api";
import type { ResourceRow } from "../types";

type TerminalShell = "auto" | "sh" | "bash" | "ash";

interface TerminalTabProps {
  api: ApiClient;
  clusterId: string;
  pod: ResourceRow;
  containers: string[];
  container: string;
  setContainer: (value: string) => void;
  autoConnectToken: number;
}

export function TerminalTab({ api, clusterId, pod, containers, container, setContainer, autoConnectToken }: TerminalTabProps) {
  const selectedContainer = container || containers[0] || "";
  const [shell, setShell] = useState<TerminalShell>("auto");
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [status, setStatus] = useState("Disconnected");
  const socketRef = useRef<WebSocket | null>(null);
  const terminalRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const copyTimerRef = useRef<number | null>(null);
  const lastCopiedSelectionRef = useRef("");
  const reconnectTimerRef = useRef<number | null>(null);
  const containersKey = containers.join("\u0000");

  useEffect(() => {
    if (!container && containers[0]) setContainer(containers[0]);
  }, [container, containersKey, setContainer]);

  useEffect(() => {
    const terminal = new XTerm({
      cursorBlink: true,
      convertEol: true,
      fontFamily: 'Consolas, "Cascadia Mono", "Liberation Mono", monospace',
      fontSize: 13,
      scrollback: 5000,
      theme: {
        background: "#070a0d",
        foreground: "#d8dee9",
        cursor: "#d8dee9",
        selectionBackground: "#3b82f655",
        black: "#0b0f14",
        blue: "#7dd3fc",
        cyan: "#67e8f9",
        green: "#86efac",
        magenta: "#c4b5fd",
        red: "#fca5a5",
        white: "#d8dee9",
        yellow: "#fbbf24",
      },
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(hostRef.current!);
    fit.fit();
    terminal.writeln("Choose a container/shell and click Connect to open kubectl exec.");
    terminal.onData((data) => {
      const socket = socketRef.current;
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "input", data }));
      }
    });
    terminal.onSelectionChange(() => {
      if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
      copyTimerRef.current = window.setTimeout(() => {
        copyTerminalSelection(terminal, lastCopiedSelectionRef);
      }, 180);
    });
    terminalRef.current = terminal;
    fitRef.current = fit;

    const fitAndResize = () => {
      try {
        fit.fit();
        sendTerminalResize(socketRef.current, terminal);
      } catch {
        // xterm can briefly be detached while drawer is resizing/closing.
      }
    };
    const onResize = () => fitAndResize();
    const resizeObserver = typeof ResizeObserver !== "undefined" && hostRef.current
      ? new ResizeObserver(() => window.requestAnimationFrame(fitAndResize))
      : null;
    if (hostRef.current) resizeObserver?.observe(hostRef.current);
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      resizeObserver?.disconnect();
      disconnectTerminal(socketRef, setConnected, setStatus, setConnecting);
      if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
      if (reconnectTimerRef.current) window.clearTimeout(reconnectTimerRef.current);
      terminal.dispose();
      terminalRef.current = null;
      fitRef.current = null;
    };
  }, [pod.uid]);

  useEffect(() => {
    window.setTimeout(() => {
      fitRef.current?.fit();
      if (terminalRef.current) sendTerminalResize(socketRef.current, terminalRef.current);
    }, 0);
  }, [selectedContainer, shell]);

  useEffect(() => {
    if (!socketRef.current) return;
    disconnectTerminal(socketRef, setConnected, setStatus, setConnecting);
    terminalRef.current?.writeln("\r\n[container or shell changed; disconnected]");
  }, [selectedContainer, shell]);

  useEffect(() => {
    if (autoConnectToken <= 0) return;
    const timer = window.setTimeout(() => connect(), 0);
    return () => window.clearTimeout(timer);
  }, [autoConnectToken]);

  function connect() {
    if (socketRef.current || connecting) return;
    const terminal = terminalRef.current;
    const fit = fitRef.current;
    if (!terminal || !fit) return;
    fit.fit();
    const socket = new WebSocket(api.podTerminalUrl(clusterId, String(pod.namespace), pod.name, selectedContainer, shell));
    socketRef.current = socket;
    terminal.clear();
    terminal.writeln(`Connecting to ${pod.name}${selectedContainer ? `/${selectedContainer}` : ""} with ${shellLabel(shell)}...`);
    setConnecting(true);
    setStatus("Connecting...");
    socket.onopen = () => {
      if (socketRef.current !== socket) return;
      setConnected(true);
      setConnecting(false);
      setStatus("Connected");
      terminal.clear();
      terminal.focus();
      sendTerminalResize(socket, terminal);
    };
    socket.onmessage = (event) => {
      if (socketRef.current !== socket) return;
      const message = parseTerminalMessage(event.data);
      if (message.type === "output") terminal.write(message.data || "");
      if (message.type === "status") setStatus(message.data || "Connected");
      if (message.type === "error") {
        setStatus("Error");
        setConnecting(false);
        terminal.writeln(`\r\n${message.data || "Terminal error"}`);
      }
    };
    socket.onclose = () => {
      if (socketRef.current && socketRef.current !== socket) return;
      socketRef.current = null;
      setConnected(false);
      setConnecting(false);
      setStatus("Disconnected");
      terminal.writeln("\r\n[session closed]");
    };
    socket.onerror = () => {
      if (socketRef.current && socketRef.current !== socket) return;
      setStatus("Connection error");
      setConnecting(false);
    };
  }

  function reconnect() {
    disconnectTerminal(socketRef, setConnected, setStatus, setConnecting);
    if (reconnectTimerRef.current) window.clearTimeout(reconnectTimerRef.current);
    reconnectTimerRef.current = window.setTimeout(() => connect(), 150);
  }

  const terminalBusy = connected || connecting;

  return (
    <section className="pod-terminal">
      <div className="terminal-toolbar">
        <label>
          Container
          <select value={selectedContainer} disabled={terminalBusy} onChange={(event) => setContainer(event.target.value)}>
            {containers.length === 0 ? <option value="">default</option> : null}
            {containers.map((name) => <option value={name} key={name}>{name}</option>)}
          </select>
        </label>
        <label>
          Shell
          <select value={shell} disabled={terminalBusy} onChange={(event) => setShell(event.target.value as TerminalShell)}>
            <option value="auto">Auto</option>
            <option value="sh">sh</option>
            <option value="bash">bash</option>
            <option value="ash">ash</option>
          </select>
        </label>
        <button className="primary" disabled={!selectedContainer || terminalBusy} onClick={connect}>
          {connecting ? "Connecting..." : "Connect"}
        </button>
        <button disabled={!connected && !connecting} onClick={() => disconnectTerminal(socketRef, setConnected, setStatus, setConnecting)}>
          Disconnect
        </button>
        <button disabled={!selectedContainer || connecting} onClick={reconnect}>
          Reconnect
        </button>
        <button onClick={() => terminalRef.current?.clear()}>
          Clear
        </button>
        <span className={terminalStatusClass(status, connected, connecting)}>{status}</span>
      </div>
      <div className="terminal-command-preview">
        kubectl exec -i -t -n {String(pod.namespace)} {pod.name}{selectedContainer ? ` -c ${selectedContainer}` : ""} -- {shellCommandPreview(shell)}
      </div>
      <p className="terminal-muted terminal-hint">
        If the selected shell is missing, choose Auto or another shell. Changing container or shell closes the current session.
      </p>
      <div className="terminal-screen xterm-host" ref={hostRef} />
    </section>
  );
}

function disconnectTerminal(
  socketRef: { current: WebSocket | null },
  setConnected: (value: boolean) => void,
  setStatus: (value: string) => void,
  setConnecting?: (value: boolean) => void,
) {
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

function shellLabel(shell: TerminalShell) {
  return shell === "auto" ? "Auto shell" : shell;
}

function shellCommandPreview(shell: TerminalShell) {
  if (shell === "auto") return 'auto shell: bash → sh → ash';
  return `${shell} -i`;
}

function terminalStatusClass(status: string, connected: boolean, connecting: boolean) {
  if (connected) return "terminal-status connected";
  if (connecting) return "terminal-status connecting";
  if (/error/i.test(status)) return "terminal-status error";
  return "terminal-status";
}

function parseTerminalMessage(value: unknown): { type: string; data?: string } {
  if (typeof value !== "string") return { type: "output", data: "" };
  try {
    const parsed = JSON.parse(value) as { type?: string; data?: string };
    return { type: parsed.type || "output", data: parsed.data || "" };
  } catch {
    return { type: "output", data: value };
  }
}

function sendTerminalResize(socket: WebSocket | null, terminal: XTerm) {
  if (socket?.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify({ type: "resize", cols: terminal.cols, rows: terminal.rows }));
}

function copyTerminalSelection(terminal: XTerm | null, lastCopiedRef?: { current: string }) {
  const selection = terminal?.getSelection();
  if (!selection || selection === lastCopiedRef?.current) return;
  lastCopiedRef && (lastCopiedRef.current = selection);
  navigator.clipboard?.writeText(selection).catch(() => undefined);
}
