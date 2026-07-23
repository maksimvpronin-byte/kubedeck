import { useEffect, useRef, useState } from "react";
import { CircleStop, Eraser, LoaderCircle, Play, RotateCw } from "lucide-react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal as XTerm } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import type { ApiClient } from "../api";
import type { ResourceRow } from "../types";
import { terminalThemeFromCss } from "../utils/terminalTheme";
import { ThemedSelect } from "./ThemedSelect";

type TerminalShell = "auto" | "sh" | "bash" | "ash";
type TerminalMessage = { type: string; data?: string; transport?: "pty" | "pipes"; commandPreview?: string };
type TerminalSize = { cols: number; rows: number };

interface TerminalTabProps {
  api: ApiClient;
  clusterId: string;
  pod: ResourceRow;
  containers: string[];
  container: string;
  setContainer: (value: string) => void;
  autoConnectToken: number;
  active?: boolean;
  onStatusChange?: (status: string) => void;
}

export function TerminalTab({ api, clusterId, pod, containers, container, setContainer, autoConnectToken, active = true, onStatusChange }: TerminalTabProps) {
  const selectedContainer = container || containers[0] || "";
  const [shell, setShell] = useState<TerminalShell>("auto");
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [status, setStatus] = useState("Disconnected");
  const [transport, setTransport] = useState<"pty" | "pipes" | "">("");
  const socketRef = useRef<WebSocket | null>(null);
  const terminalRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const copyTimerRef = useRef<number | null>(null);
  const lastCopiedSelectionRef = useRef("");
  const reconnectTimerRef = useRef<number | null>(null);
  const lastResizeRef = useRef<TerminalSize | null>(null);
  const firstOutputFitRef = useRef(false);
  const onStatusChangeRef = useRef(onStatusChange);
  const activeRef = useRef(active);
  onStatusChangeRef.current = onStatusChange;
  activeRef.current = active;
  const containersKey = containers.join("\u0000");

  useEffect(() => onStatusChangeRef.current?.(status), [status]);

  useEffect(() => {
    if (!active) return;
    const timer = window.setTimeout(() => {
      const terminal = terminalRef.current;
      const fit = fitRef.current;
      if (terminal && fit) fitAndResizeTerminal(fit, socketRef.current, terminal, lastResizeRef);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [active]);

  useEffect(() => {
    if (!container && containers[0]) setContainer(containers[0]);
  }, [container, containersKey, setContainer]);

  useEffect(() => {
    const terminal = new XTerm({
      cursorBlink: true,
      fontFamily: 'Consolas, "Cascadia Mono", "Liberation Mono", monospace',
      fontSize: 13,
      scrollback: 5000,
      theme: terminalThemeFromCss(),
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(hostRef.current!);
    fit.fit();
    terminal.writeln("Choose a container/shell and click Connect to open kubectl exec.");
    terminal.onData((data) => {
      sendTerminalInput(socketRef.current, data);
    });
    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type !== "keydown") return true;
      const key = event.key.toLowerCase();
      const copyRequested = (event.ctrlKey && event.shiftKey && key === "c") || (event.ctrlKey && event.key === "Insert");
      if (copyRequested || (event.ctrlKey && !event.shiftKey && key === "c" && terminal.hasSelection())) {
        copyTerminalSelection(terminal, lastCopiedSelectionRef, true);
        return false;
      }
      return true;
    });
    terminal.onSelectionChange(() => {
      if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
      copyTimerRef.current = window.setTimeout(() => {
        copyTerminalSelection(terminal, lastCopiedSelectionRef);
      }, 180);
    });
    terminalRef.current = terminal;
    fitRef.current = fit;

    const scheduleFitAndResize = () => {
      if (!activeRef.current) return;
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(fitAndResize);
      });
    };
    const fitAndResize = () => {
      const bounds = hostRef.current?.getBoundingClientRect();
      if (!activeRef.current || !bounds || bounds.width <= 0 || bounds.height <= 0) return;
      try {
        fit.fit();
        sendTerminalResizeIfChanged(socketRef.current, terminal, lastResizeRef);
      } catch {
        // xterm can briefly be detached while drawer is resizing/closing.
      }
    };
    const onResize = () => fitAndResize();
    const resizeObserver = typeof ResizeObserver !== "undefined" && hostRef.current ? new ResizeObserver(scheduleFitAndResize) : null;
    if (hostRef.current) resizeObserver?.observe(hostRef.current);
    window.addEventListener("resize", onResize);
    const onThemeChange = () => {
      terminal.options.theme = terminalThemeFromCss();
    };
    window.addEventListener("kubedeck-theme-change", onThemeChange);
    scheduleFitAndResize();

    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("kubedeck-theme-change", onThemeChange);
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
    const timer = window.setTimeout(() => {
      window.requestAnimationFrame(() => {
        const terminal = terminalRef.current;
        const fit = fitRef.current;
        if (terminal && fit) fitAndResizeTerminal(fit, socketRef.current, terminal, lastResizeRef);
      });
    }, 0);
    return () => window.clearTimeout(timer);
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
    lastResizeRef.current = null;
    firstOutputFitRef.current = false;
    window.requestAnimationFrame(() => {
      fit.fit();
      sendTerminalResizeIfChanged(socketRef.current, terminal, lastResizeRef);
    });
    fit.fit();
    const initialSize = terminalSize(terminal);
    lastResizeRef.current = initialSize;
    const socket = new WebSocket(api.podTerminalUrl(clusterId, String(pod.namespace), pod.name, selectedContainer, shell, initialSize));
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
      fitAndResizeTerminal(fit, socket, terminal, lastResizeRef);
      window.setTimeout(() => fitAndResizeTerminal(fit, socket, terminal, lastResizeRef), 50);
      window.setTimeout(() => fitAndResizeTerminal(fit, socket, terminal, lastResizeRef), 180);
    };
    socket.onmessage = (event) => {
      if (socketRef.current !== socket) return;
      const message = parseTerminalMessage(event.data);
      if (message.type === "output") {
        terminal.write(message.data || "");
        if (!firstOutputFitRef.current) {
          firstOutputFitRef.current = true;
          window.setTimeout(() => fitAndResizeTerminal(fit, socket, terminal, lastResizeRef), 50);
        }
      }
      if (message.type === "status") {
        if (message.transport) setTransport(message.transport);
        setStatus(statusText(message.data || "Connected", message.transport));
        if (message.transport === "pipes") {
          terminal.writeln("\r\n[KubeDeck warning: PTY unavailable; interactive editing may be unstable.]");
        }
      }
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
      setTransport("");
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
          <ThemedSelect
            ariaLabel="Container"
            value={selectedContainer}
            disabled={terminalBusy}
            options={containers.length ? containers.map((name) => ({ value: name, label: name })) : [{ value: "", label: "default" }]}
            onChange={setContainer}
          />
        </label>
        <label title="Auto tries bash, then sh, then ash">
          Shell
          <ThemedSelect
            ariaLabel="Shell"
            value={shell}
            disabled={terminalBusy}
            options={[
              { value: "auto", label: "Auto" },
              { value: "sh", label: "sh" },
              { value: "bash", label: "bash" },
              { value: "ash", label: "ash" },
            ]}
            onChange={(value) => setShell(value as TerminalShell)}
          />
        </label>
        <button
          className="primary terminal-icon-action"
          title="Connect terminal"
          data-tooltip="Connect terminal"
          aria-label="Connect terminal"
          disabled={!selectedContainer || terminalBusy}
          onClick={connect}
        >
          {connecting ? <LoaderCircle className="terminal-action-spinner" size={16} /> : <Play size={16} />}
        </button>
        <button
          className="terminal-icon-action"
          title="Disconnect terminal"
          data-tooltip="Disconnect terminal"
          aria-label="Disconnect terminal"
          disabled={!connected && !connecting}
          onClick={() => disconnectTerminal(socketRef, setConnected, setStatus, setConnecting)}
        >
          <CircleStop size={16} />
        </button>
        <button
          className="terminal-icon-action"
          title="Reconnect terminal"
          data-tooltip="Reconnect terminal"
          aria-label="Reconnect terminal"
          disabled={!selectedContainer || connecting}
          onClick={reconnect}
        >
          <RotateCw size={16} />
        </button>
        <button className="terminal-icon-action" title="Clear terminal" data-tooltip="Clear terminal" aria-label="Clear terminal" onClick={() => terminalRef.current?.clear()}>
          <Eraser size={16} />
        </button>
        {transport && connected ? (
          <span className={`terminal-transport ${transport}`} title={`Connected using ${transport.toUpperCase()}`}>
            {transport.toUpperCase()}
          </span>
        ) : (
          <span className={terminalStatusClass(status, connected, connecting)}>{status}</span>
        )}
      </div>
      <div className="terminal-screen xterm-host" ref={hostRef} />
    </section>
  );
}

function disconnectTerminal(socketRef: { current: WebSocket | null }, setConnected: (value: boolean) => void, setStatus: (value: string) => void, setConnecting?: (value: boolean) => void) {
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

function terminalStatusClass(status: string, connected: boolean, connecting: boolean) {
  if (connected) return "terminal-status connected";
  if (connecting) return "terminal-status connecting";
  if (/error/i.test(status)) return "terminal-status error";
  return "terminal-status";
}

function parseTerminalMessage(value: unknown): TerminalMessage {
  if (typeof value !== "string") return { type: "output", data: "" };
  try {
    const parsed = JSON.parse(value) as TerminalMessage;
    return { type: parsed.type || "output", data: parsed.data || "", transport: parsed.transport, commandPreview: parsed.commandPreview };
  } catch {
    return { type: "output", data: value };
  }
}

function sendTerminalInput(socket: WebSocket | null, data: string) {
  if (socket?.readyState !== WebSocket.OPEN || !data) return;
  socket.send(JSON.stringify({ type: "input", data }));
}

function fitAndResizeTerminal(fit: FitAddon, socket: WebSocket | null, terminal: XTerm, lastSizeRef: { current: TerminalSize | null }) {
  try {
    fit.fit();
    sendTerminalResizeIfChanged(socket, terminal, lastSizeRef);
  } catch {
    // xterm can briefly report an invalid viewport while the drawer is resizing.
  }
}

function sendTerminalResizeIfChanged(socket: WebSocket | null, terminal: XTerm, lastSizeRef: { current: TerminalSize | null }) {
  if (socket?.readyState !== WebSocket.OPEN) return;
  const cols = terminal.cols;
  const rows = terminal.rows;
  if (!Number.isFinite(cols) || !Number.isFinite(rows) || cols <= 0 || rows <= 0) return;
  const lastSize = lastSizeRef.current;
  if (lastSize && lastSize.cols === cols && lastSize.rows === rows) return;
  lastSizeRef.current = { cols, rows };
  socket.send(JSON.stringify({ type: "resize", cols, rows }));
}

function terminalSize(terminal: XTerm): TerminalSize {
  const cols = Number.isFinite(terminal.cols) && terminal.cols > 0 ? terminal.cols : 100;
  const rows = Number.isFinite(terminal.rows) && terminal.rows > 0 ? terminal.rows : 24;
  return { cols: Math.trunc(cols), rows: Math.trunc(rows) };
}

function copyTerminalSelection(terminal: XTerm | null, lastCopiedRef?: { current: string }, force = false) {
  const selection = terminal?.getSelection();
  if (!selection || (!force && selection === lastCopiedRef?.current)) return;
  lastCopiedRef && (lastCopiedRef.current = selection);
  navigator.clipboard?.writeText(selection).catch(() => undefined);
}

function statusText(value: string, transport?: "pty" | "pipes") {
  if (!transport || value.toLowerCase() !== "connected") return value;
  return `Connected (${transport.toUpperCase()})`;
}
