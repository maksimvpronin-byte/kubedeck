import { useEffect, useMemo, useRef, useState } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal as XTerm } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import type { ApiClient } from "../api";
import type { ResourceRow, Settings } from "../types";
import { resolveSshDefaults } from "../utils/sshDefaults";
import { terminalThemeFromCss } from "../utils/terminalTheme";
import { copyTerminalSelection, disconnectTerminal, fitAndResizeTerminal, sendTerminalResizeIfChanged, terminalStatusClass, type TerminalSize } from "../utils/xtermSession";

type AuthMethod = "agent" | "password" | "privateKey";

type TerminalMessage = { type: string; data?: unknown; code?: string };

interface HostKeyPrompt {
  role: "target" | "jump";
  host: string;
  port: number;
  algorithm: string;
  fingerprint: string;
}

function englishFallback(key: string): string {
  const strings: Record<string, string> = {
    "ssh.hostKey.title": "Unknown SSH host key",
    "ssh.hostKey.intro": "This host has not been used before. Confirm the fingerprint before continuing.",
    "ssh.hostKey.role.target": "Target host",
    "ssh.hostKey.role.jump": "Jump host",
    "ssh.hostKey.host": "Host",
    "ssh.hostKey.algorithm": "Key type",
    "ssh.hostKey.fingerprint": "SHA256 fingerprint",
    "ssh.hostKey.hint": "Compare it with `ssh-keyscan -t <type> <host>` run from a trusted machine. KubeDeck sends no password until you accept.",
    "ssh.hostKey.trust": "Connect and remember",
    "ssh.hostKey.cancel": "Cancel",
    "ssh.hostKey.waiting": "Waiting for host key confirmation",
    "ssh.hostKey.rejected": "Host key rejected",
    "ssh.hostKey.mismatch": "Host key mismatch",
  };
  return strings[key] ?? key;
}

function hostKeyPromptFrom(value: unknown): HostKeyPrompt | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const host = String(record.host ?? "");
  const fingerprint = String(record.fingerprint ?? "");
  if (!host || !fingerprint) return null;
  return {
    role: record.role === "jump" ? "jump" : "target",
    host,
    port: Number(record.port) || 22,
    algorithm: String(record.algorithm ?? "unknown"),
    fingerprint,
  };
}

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
  active?: boolean;
  t?: (key: string) => string;
}

export function NodeSshTab({ api, clusterId, node, settings, active = true, t }: NodeSshTabProps) {
  const label = (key: string) => {
    const translated = t?.(key);
    return !translated || translated === key ? englishFallback(key) : translated;
  };
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
  const [hostKeyPrompt, setHostKeyPrompt] = useState<HostKeyPrompt | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const terminalRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const copyTimerRef = useRef<number | null>(null);
  const lastCopiedSelectionRef = useRef("");
  const lastResizeRef = useRef<TerminalSize | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => {
    if (!active) return;
    const timer = window.setTimeout(() => {
      const terminal = terminalRef.current;
      const fit = fitRef.current;
      const bounds = hostRef.current?.getBoundingClientRect();
      if (!terminal || !fit || !bounds || bounds.width <= 0 || bounds.height <= 0) return;
      fitAndResizeTerminal(fit, socketRef.current, terminal, lastResizeRef);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [active]);

  useEffect(() => {
    if (socketRef.current) return;
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
      const bounds = hostRef.current?.getBoundingClientRect();
      if (!activeRef.current || !bounds || bounds.width <= 0 || bounds.height <= 0) return;
      fitAndResizeTerminal(fit, socketRef.current, terminal, lastResizeRef);
    };
    const resizeObserver = typeof ResizeObserver !== "undefined" && hostRef.current ? new ResizeObserver(() => window.requestAnimationFrame(() => window.requestAnimationFrame(fitAndResize))) : null;
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
    lastResizeRef.current = null;
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
      const text = typeof message.data === "string" ? message.data : "";
      if (message.type === "output") terminal.write(text);
      if (message.type === "host-key-request") {
        const prompt = hostKeyPromptFrom(message.data);
        if (!prompt) return;
        setHostKeyPrompt(prompt);
        setStatus(label("ssh.hostKey.waiting"));
        terminal.writeln(`\r\n${label("ssh.hostKey.title")}: ${prompt.host}:${prompt.port} ${prompt.algorithm} ${prompt.fingerprint}`);
        return;
      }
      if (message.type === "status") {
        setStatus(text || "Connected");
        if (text.toLowerCase() === "connected") {
          setConnected(true);
          setConnecting(false);
          terminal.focus();
          sendTerminalResizeIfChanged(socket, terminal, lastResizeRef);
        }
      }
      if (message.type === "error") {
        setHostKeyPrompt(null);
        setStatus(message.code === "SSH_HOST_KEY_MISMATCH" ? label("ssh.hostKey.mismatch") : "Error");
        setConnecting(false);
        terminal.writeln(`\r\n${text || "SSH error"}`);
      }
    };
    socket.onclose = () => {
      if (socketRef.current && socketRef.current !== socket) return;
      socketRef.current = null;
      setConnected(false);
      setConnecting(false);
      setHostKeyPrompt(null);
      setStatus("Disconnected");
      terminal.writeln("\r\n[session closed]");
    };
    socket.onerror = () => {
      if (socketRef.current && socketRef.current !== socket) return;
      setStatus("Connection error");
      setConnecting(false);
    };
  }

  function respondToHostKey(decision: "trust" | "reject") {
    const socket = socketRef.current;
    setHostKeyPrompt(null);
    // Resizes sent while the prompt was open were ignored by the Gateway, so the
    // remembered size is stale and the real one must be reported once connected.
    lastResizeRef.current = null;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "host-key-decision", decision }));
    }
    if (decision === "reject") setStatus(label("ssh.hostKey.rejected"));
  }

  const terminalBusy = connected || connecting;
  return (
    <div className={`node-ssh-tab ${terminalBusy ? "is-session-active" : "is-configuring"}`}>
      {hostKeyPrompt ? (
        <div className="ssh-host-key-prompt" role="alertdialog" aria-label={label("ssh.hostKey.title")}>
          <strong>{label("ssh.hostKey.title")}</strong>
          <p>{label("ssh.hostKey.intro")}</p>
          <dl>
            <dt>{label(hostKeyPrompt.role === "jump" ? "ssh.hostKey.role.jump" : "ssh.hostKey.role.target")}</dt>
            <dd>
              {hostKeyPrompt.host}:{hostKeyPrompt.port}
            </dd>
            <dt>{label("ssh.hostKey.algorithm")}</dt>
            <dd>{hostKeyPrompt.algorithm}</dd>
            <dt>{label("ssh.hostKey.fingerprint")}</dt>
            <dd className="ssh-host-key-fingerprint">{hostKeyPrompt.fingerprint}</dd>
          </dl>
          <p className="ssh-host-key-hint">{label("ssh.hostKey.hint")}</p>
          <div className="ssh-host-key-actions">
            <button className="primary" type="button" onClick={() => respondToHostKey("trust")}>
              {label("ssh.hostKey.trust")}
            </button>
            <button type="button" onClick={() => respondToHostKey("reject")}>
              {label("ssh.hostKey.cancel")}
            </button>
          </div>
        </div>
      ) : null}
      {!terminalBusy ? (
        <div className="node-ssh-config">
          <div className="node-ssh-grid">
            <label>
              Host <input value={host} onChange={(event) => setHost(event.target.value)} />
            </label>
            <label>
              Port <input value={port} onChange={(event) => setPort(event.target.value)} />
            </label>
            <label>
              Username <input value={username} onChange={(event) => setUsername(event.target.value)} />
            </label>
            <label>
              Auth
              <select value={authMethod} onChange={(event) => setAuthMethod(event.target.value as AuthMethod)}>
                <option value="agent">Agent/default keys</option>
                <option value="password">Password</option>
                <option value="privateKey">Private key path</option>
              </select>
            </label>
            {authMethod === "password" ? (
              <label>
                Password <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
              </label>
            ) : null}
            {authMethod === "privateKey" ? (
              <>
                <label className="wide">
                  Private key path <input value={keyPath} onChange={(event) => setKeyPath(event.target.value)} placeholder="C:\\Users\\Fidel\\.ssh\\id_rsa" />
                </label>
                <label>
                  Passphrase <input type="password" value={keyPassphrase} onChange={(event) => setKeyPassphrase(event.target.value)} />
                </label>
              </>
            ) : null}
          </div>

          <label className="node-ssh-jump-toggle">
            <input type="checkbox" checked={useJumpHost} onChange={(event) => setUseJumpHost(event.target.checked)} /> Use jump host
          </label>
          {useJumpHost ? (
            <div className="node-ssh-grid node-ssh-jump-grid">
              <label>
                Jump host <input value={jumpHost} onChange={(event) => setJumpHost(event.target.value)} />
              </label>
              <label>
                Jump port <input value={jumpPort} onChange={(event) => setJumpPort(event.target.value)} />
              </label>
              <label>
                Jump user <input value={jumpUsername} onChange={(event) => setJumpUsername(event.target.value)} placeholder={username || "same as target"} />
              </label>
              <label>
                Jump auth
                <select value={jumpAuthMethod} onChange={(event) => setJumpAuthMethod(event.target.value as AuthMethod)}>
                  <option value="agent">Agent/default keys</option>
                  <option value="password">Password</option>
                  <option value="privateKey">Private key path</option>
                </select>
              </label>
              {jumpAuthMethod === "password" ? (
                <label>
                  Jump password <input type="password" value={jumpPassword} onChange={(event) => setJumpPassword(event.target.value)} />
                </label>
              ) : null}
              {jumpAuthMethod === "privateKey" ? (
                <>
                  <label className="wide">
                    Jump key path <input value={jumpKeyPath} onChange={(event) => setJumpKeyPath(event.target.value)} />
                  </label>
                  <label>
                    Jump passphrase <input type="password" value={jumpKeyPassphrase} onChange={(event) => setJumpKeyPassphrase(event.target.value)} />
                  </label>
                </>
              ) : null}
            </div>
          ) : null}
          <div className="terminal-command-preview">{sshPreview(username, host, port, authMethod, keyPath, useJumpHost, jumpUsername || username, jumpHost, jumpPort)}</div>
          <p className="node-ssh-note">Secrets are not saved. Target host defaults to node InternalIP. Username, port and jump host defaults are loaded from Settings.</p>
        </div>
      ) : (
        <div className="node-ssh-session-target">
          SSH · {username}@{host}:{port || "22"}
          {useJumpHost && jumpHost ? ` · via ${jumpHost}` : ""}
        </div>
      )}

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
      <div className="terminal-screen xterm-host" ref={hostRef} />
    </div>
  );
}

function parseTerminalMessage(value: unknown): TerminalMessage {
  if (typeof value !== "string") return { type: "output", data: "" };
  try {
    const parsed = JSON.parse(value) as TerminalMessage;
    return { type: parsed.type || "output", data: parsed.data ?? "", code: typeof parsed.code === "string" ? parsed.code : undefined };
  } catch {
    return { type: "output", data: value };
  }
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
