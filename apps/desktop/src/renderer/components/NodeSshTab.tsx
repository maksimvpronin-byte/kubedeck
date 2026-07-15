import { useEffect, useMemo, useRef, useState } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal as XTerm } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import type { ApiClient } from "../api";
import type { ResourceRow, Settings } from "../types";
import { resolveSshDefaults } from "../utils/sshDefaults";
import { terminalThemeFromCss } from "../utils/terminalTheme";

type AuthMethod = "agent" | "password" | "privateKey";

type TerminalMessage = { type: string; data?: string };

function normalizeAuthMethod(value: unknown): AuthMethod {
  return value === "password" || value === "privateKey" ? value : "agent";
}

function normalizePort(value: unknown, fallback = 22) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 65535) return String(fallback);
  return String(Math.trunc(parsed));
}

interface NodeSshTabProps {
  api: ApiClient;
  clusterId: string;
  node: ResourceRow;
  settings?: Settings;
}

export function NodeSshTab({ api, clusterId, node, settings }: NodeSshTabProps) {
  const defaultHost = String(node.internalIp || node.internalIP || node.hostIP || node.hostname || node.name || "");
  const sshSettings = useMemo(() => resolveSshDefaults(settings), [settings]);
  const [host, setHost] = useState(defaultHost);
  const [port, setPort] = useState(normalizePort(sshSettings.defaultPort));
  const [username, setUsername] = useState(sshSettings.defaultUsername);
  const [authMethod, setAuthMethod] = useState<AuthMethod>(normalizeAuthMethod(sshSettings.defaultAuthMethod));
  const [password, setPassword] = useState("");
  const [keyPath, setKeyPath] = useState("");
  const [keyPassphrase, setKeyPassphrase] = useState("");
  const [useJumpHost, setUseJumpHost] = useState(Boolean(sshSettings.useJumpHost));
  const [jumpHost, setJumpHost] = useState(sshSettings.jumpHost);
  const [jumpPort, setJumpPort] = useState(normalizePort(sshSettings.jumpPort));
  const [jumpUsername, setJumpUsername] = useState(sshSettings.jumpUsername);
  const [jumpAuthMethod, setJumpAuthMethod] = useState<AuthMethod>(normalizeAuthMethod(sshSettings.jumpAuthMethod));
  const [jumpPassword, setJumpPassword] = useState("");
  const [jumpKeyPath, setJumpKeyPath] = useState("");
  const [jumpKeyPassphrase, setJumpKeyPassphrase] = useState("");
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [status, setStatus] = useState("Disconnected");
  const socketRef = useRef<WebSocket | null>(null);
  const terminalRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const copyTimerRef = useRef<number | null>(null);
  const lastCopiedSelectionRef = useRef("");

  useEffect(() => {
    setHost(defaultHost);
    setPort(normalizePort(sshSettings.defaultPort));
    setUsername(sshSettings.defaultUsername);
    setAuthMethod(normalizeAuthMethod(sshSettings.defaultAuthMethod));
    setPassword("");
    setKeyPath("");
    setKeyPassphrase("");
    setUseJumpHost(Boolean(sshSettings.useJumpHost));
    setJumpHost(sshSettings.jumpHost);
    setJumpPort(normalizePort(sshSettings.jumpPort));
    setJumpUsername(sshSettings.jumpUsername);
    setJumpAuthMethod(normalizeAuthMethod(sshSettings.jumpAuthMethod));
    setJumpPassword("");
    setJumpKeyPath("");
    setJumpKeyPassphrase("");
    setStatus("Disconnected");
  }, [defaultHost, sshSettings]);

  useEffect(() => {
    const terminal = new XTerm({
      cursorBlink: true,
      convertEol: true,
      fontFamily: 'Consolas, "Cascadia Mono", "Liberation Mono", monospace',
      fontSize: 13,
      scrollback: 5000,
      theme: terminalThemeFromCss(),
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(hostRef.current!);
    fit.fit();
    terminal.writeln("Configure SSH credentials and click Connect.");
    terminal.writeln("Passwords and key passphrases are used only for this session and are not saved.");
    terminal.onData((data) => {
      const socket = socketRef.current;
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "input", data }));
    });
    terminal.onSelectionChange(() => {
      if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
      copyTimerRef.current = window.setTimeout(() => copyTerminalSelection(terminal, lastCopiedSelectionRef), 180);
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
    const resizeObserver = typeof ResizeObserver !== "undefined" && hostRef.current ? new ResizeObserver(() => window.requestAnimationFrame(fitAndResize)) : null;
    if (hostRef.current) resizeObserver?.observe(hostRef.current);
    window.addEventListener("resize", fitAndResize);
    const onThemeChange = () => {
      terminal.options.theme = terminalThemeFromCss();
    };
    window.addEventListener("kubedeck-theme-change", onThemeChange);

    return () => {
      window.removeEventListener("resize", fitAndResize);
      window.removeEventListener("kubedeck-theme-change", onThemeChange);
      resizeObserver?.disconnect();
      disconnectTerminal(socketRef, setConnected, setStatus, setConnecting);
      if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
      terminal.dispose();
      terminalRef.current = null;
      fitRef.current = null;
    };
  }, [node.uid]);

  function connect() {
    if (socketRef.current || connecting) return;
    const terminal = terminalRef.current;
    const fit = fitRef.current;
    if (!terminal || !fit) return;
    if (!host.trim() || !username.trim()) {
      setStatus("Host and username are required");
      terminal.writeln("\r\nHost and username are required.");
      return;
    }
    fit.fit();
    const socket = new WebSocket(api.nodeSshUrl(clusterId, node.name));
    socketRef.current = socket;
    terminal.clear();
    terminal.writeln(`Connecting to ${username}@${host}:${port || "22"}...`);
    setConnecting(true);
    setStatus("Connecting...");
    socket.onopen = () => {
      if (socketRef.current !== socket) return;
      socket.send(
        JSON.stringify({
          type: "connect",
          host: host.trim(),
          port: Number(port) || 22,
          username: username.trim(),
          authMethod,
          password: authMethod === "password" ? password : "",
          keyPath: authMethod === "privateKey" ? keyPath.trim() : "",
          keyPassphrase: authMethod === "privateKey" ? keyPassphrase : "",
          useJumpHost,
          jumpHost: useJumpHost ? jumpHost.trim() : "",
          jumpPort: Number(jumpPort) || 22,
          jumpUsername: useJumpHost ? jumpUsername.trim() || username.trim() : "",
          jumpAuthMethod,
          jumpPassword: useJumpHost && jumpAuthMethod === "password" ? jumpPassword : "",
          jumpKeyPath: useJumpHost && jumpAuthMethod === "privateKey" ? jumpKeyPath.trim() : "",
          jumpKeyPassphrase: useJumpHost && jumpAuthMethod === "privateKey" ? jumpKeyPassphrase : "",
          cols: terminal.cols,
          rows: terminal.rows,
        }),
      );
    };
    socket.onmessage = (event) => {
      if (socketRef.current !== socket) return;
      const message = parseTerminalMessage(event.data);
      if (message.type === "output") terminal.write(message.data || "");
      if (message.type === "status") {
        setStatus(message.data || "Connected");
        if ((message.data || "").toLowerCase() === "connected") {
          setConnected(true);
          setConnecting(false);
          terminal.focus();
          sendTerminalResize(socket, terminal);
        }
      }
      if (message.type === "error") {
        setStatus("Error");
        setConnecting(false);
        terminal.writeln(`\r\n${message.data || "SSH error"}`);
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

  const terminalBusy = connected || connecting;
  return (
    <div className="node-ssh-tab">
      <div className="node-ssh-grid">
        <label>
          Host <input value={host} onChange={(event) => setHost(event.target.value)} disabled={terminalBusy} />
        </label>
        <label>
          Port <input value={port} onChange={(event) => setPort(event.target.value)} disabled={terminalBusy} />
        </label>
        <label>
          Username <input value={username} onChange={(event) => setUsername(event.target.value)} disabled={terminalBusy} />
        </label>
        <label>
          Auth
          <select value={authMethod} onChange={(event) => setAuthMethod(event.target.value as AuthMethod)} disabled={terminalBusy}>
            <option value="agent">Agent/default keys</option>
            <option value="password">Password</option>
            <option value="privateKey">Private key path</option>
          </select>
        </label>
        {authMethod === "password" ? (
          <label>
            Password <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} disabled={terminalBusy} />
          </label>
        ) : null}
        {authMethod === "privateKey" ? (
          <>
            <label className="wide">
              Private key path <input value={keyPath} onChange={(event) => setKeyPath(event.target.value)} disabled={terminalBusy} placeholder="C:\\Users\\Fidel\\.ssh\\id_rsa" />
            </label>
            <label>
              Passphrase <input type="password" value={keyPassphrase} onChange={(event) => setKeyPassphrase(event.target.value)} disabled={terminalBusy} />
            </label>
          </>
        ) : null}
      </div>

      <label className="node-ssh-jump-toggle">
        <input type="checkbox" checked={useJumpHost} onChange={(event) => setUseJumpHost(event.target.checked)} disabled={terminalBusy} /> Use jump host
      </label>
      {useJumpHost ? (
        <div className="node-ssh-grid node-ssh-jump-grid">
          <label>
            Jump host <input value={jumpHost} onChange={(event) => setJumpHost(event.target.value)} disabled={terminalBusy} />
          </label>
          <label>
            Jump port <input value={jumpPort} onChange={(event) => setJumpPort(event.target.value)} disabled={terminalBusy} />
          </label>
          <label>
            Jump user <input value={jumpUsername} onChange={(event) => setJumpUsername(event.target.value)} disabled={terminalBusy} placeholder={username || "same as target"} />
          </label>
          <label>
            Jump auth
            <select value={jumpAuthMethod} onChange={(event) => setJumpAuthMethod(event.target.value as AuthMethod)} disabled={terminalBusy}>
              <option value="agent">Agent/default keys</option>
              <option value="password">Password</option>
              <option value="privateKey">Private key path</option>
            </select>
          </label>
          {jumpAuthMethod === "password" ? (
            <label>
              Jump password <input type="password" value={jumpPassword} onChange={(event) => setJumpPassword(event.target.value)} disabled={terminalBusy} />
            </label>
          ) : null}
          {jumpAuthMethod === "privateKey" ? (
            <>
              <label className="wide">
                Jump key path <input value={jumpKeyPath} onChange={(event) => setJumpKeyPath(event.target.value)} disabled={terminalBusy} />
              </label>
              <label>
                Jump passphrase <input type="password" value={jumpKeyPassphrase} onChange={(event) => setJumpKeyPassphrase(event.target.value)} disabled={terminalBusy} />
              </label>
            </>
          ) : null}
        </div>
      ) : null}

      <div className="terminal-toolbar">
        <button className="primary" disabled={!host.trim() || !username.trim() || terminalBusy} onClick={connect}>
          {connecting ? "Connecting..." : "Connect"}
        </button>
        <button disabled={!connected && !connecting} onClick={() => disconnectTerminal(socketRef, setConnected, setStatus, setConnecting)}>
          Disconnect
        </button>
        <button onClick={() => terminalRef.current?.clear()}>Clear</button>
        <span className={terminalStatusClass(status, connected, connecting)}>{status}</span>
      </div>
      <div className="terminal-command-preview">{sshPreview(username, host, port, authMethod, keyPath, useJumpHost, jumpUsername || username, jumpHost, jumpPort)}</div>
      <p className="node-ssh-note">Secrets are not saved. Target host defaults to node InternalIP. Username, port and jump host defaults are loaded from Settings.</p>
      <div className="terminal-screen xterm-host" ref={hostRef} />
    </div>
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

function parseTerminalMessage(value: unknown): TerminalMessage {
  if (typeof value !== "string") return { type: "output", data: "" };
  try {
    const parsed = JSON.parse(value) as TerminalMessage;
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

function terminalStatusClass(status: string, connected: boolean, connecting: boolean) {
  if (connected) return "terminal-status connected";
  if (connecting) return "terminal-status connecting";
  if (/error/i.test(status)) return "terminal-status error";
  return "terminal-status";
}

function sshPreview(username: string, host: string, port: string, authMethod: AuthMethod, keyPath: string, useJumpHost: boolean, jumpUsername: string, jumpHost: string, jumpPort: string) {
  const parts = ["ssh"];
  if (port && port !== "22") parts.push("-p", port);
  if (authMethod === "privateKey" && keyPath.trim()) parts.push("-i", keyPath.trim());
  if (useJumpHost && jumpHost.trim()) {
    const jump = `${jumpUsername || username}@${jumpHost.trim()}${jumpPort && jumpPort !== "22" ? `:${jumpPort}` : ""}`;
    parts.push("-J", jump);
  }
  parts.push(`${username || "user"}@${host || "host"}`);
  return parts.join(" ");
}
