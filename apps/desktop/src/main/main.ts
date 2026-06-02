import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from "electron";
import { spawn, spawnSync, ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";

let mainWindow: BrowserWindow | null = null;
let backend: ChildProcessWithoutNullStreams | null = null;
let backendUrl = "";
let backendSessionToken = "";
let backendPid: number | null = null;
let backendStopping = false;

type BackendPidFile = {
  app: "KubeDeck Backend";
  pid: number;
  startedAt: string;
  command: string;
  tokenHash: string;
};

type AppFolder = "root" | "logs" | "config" | "kubeconfigs";

type BackendConfig = {
  clusters: Array<{ id: string; kubeconfigPath: string }>;
  settings: { kubectlPath: string };
};

const SENSITIVE_MARKERS = [
  "token",
  "password",
  "passwd",
  "secret",
  "client-key-data",
  "client-certificate-data",
  "certificate-authority-data",
  "authorization",
  "bearer",
  "api-key",
  "apikey",
  "private-key",
];

function appDataRoot() {
  return path.join(app.getPath("appData"), "KubeDeck");
}

function logsDir() {
  const dir = path.join(appDataRoot(), "logs");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function kubeconfigsDir() {
  const dir = path.join(appDataRoot(), "kubeconfigs");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function configFilePath() {
  fs.mkdirSync(appDataRoot(), { recursive: true });
  return path.join(appDataRoot(), "config.json");
}

function appFolderPath(folder: AppFolder) {
  if (folder === "logs") return logsDir();
  if (folder === "kubeconfigs") return kubeconfigsDir();
  if (folder === "config") return configFilePath();
  return appDataRoot();
}

function sanitizeLogText(value: string) {
  return String(value ?? "")
    .split(/\r?\n/)
    .map((line) => {
      const lowered = line.toLowerCase();
      return SENSITIVE_MARKERS.some((marker) => lowered.includes(marker)) ? "[redacted sensitive line]" : line;
    })
    .join("\n");
}

function logDesktop(message: string) {
  fs.appendFileSync(path.join(logsDir(), "desktop.log"), `${new Date().toISOString()} ${sanitizeLogText(message)}\n`, "utf-8");
}

function backendPidPath() {
  return path.join(appDataRoot(), "backend.pid");
}

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Unable to allocate backend port"));
        return;
      }
      const port = address.port;
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function waitForBackendReady(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "";
  while (Date.now() < deadline) {
    if (backend && backend.exitCode !== null) {
      throw new Error(`Backend exited before becoming ready. exitCode=${backend.exitCode}`);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    try {
      const response = await fetch(`${backendUrl}/health`, {
        headers: { "X-KubeDeck-Token": backendSessionToken },
        signal: controller.signal,
      });
      if (response.ok) {
        logDesktop(`backend ready url=${backendUrl}`);
        return;
      }
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = String(error);
    } finally {
      clearTimeout(timer);
    }
    await delay(250);
  }
  throw new Error(`Backend did not become ready within ${timeoutMs}ms. Last error: ${lastError || "unknown"}`);
}

async function startBackend() {
  cleanupStaleBackend();
  const port = await findFreePort();
  backendSessionToken = randomBytes(32).toString("base64url");
  backendUrl = `http://127.0.0.1:${port}`;
  const projectRoot = path.resolve(__dirname, "../../../..");
  const backendCwd = path.join(projectRoot, "apps", "backend");
  const packagedBackend = resolvePackagedBackend();
  const usePackagedBackend = app.isPackaged && fs.existsSync(packagedBackend);
  const env = {
    ...process.env,
    KUBEDECK_BACKEND_PORT: String(port),
    KUBEDECK_SESSION_TOKEN: backendSessionToken,
    ...(usePackagedBackend ? {} : { PYTHONPATH: backendCwd }),
  };
  const command = usePackagedBackend ? packagedBackend : "py";
  const args = usePackagedBackend ? [] : ["-3", "-m", "kubedeck_backend.main"];
  backend = spawn(command, args, {
    cwd: usePackagedBackend ? path.dirname(packagedBackend) : backendCwd,
    env,
    windowsHide: true,
    detached: false,
  });
  backendPid = backend.pid ?? null;
  if (backendPid) writeBackendPidFile({ app: "KubeDeck Backend", pid: backendPid, startedAt: new Date().toISOString(), command, tokenHash: tokenHash(backendSessionToken) });
  logDesktop(`backend start url=${backendUrl} pid=${backendPid ?? "unknown"} packaged=${usePackagedBackend} command=${command}`);
  backend.stdout.on("data", (chunk) => logDesktop(`backend stdout ${chunk.toString().trim()}`));
  backend.stderr.on("data", (chunk) => logDesktop(`backend stderr ${chunk.toString().trim()}`));
  backend.on("exit", (code, signal) => {
    logDesktop(`backend exit code=${code} signal=${signal}`);
    clearBackendPidFile(backendPid);
    backend = null;
    backendPid = null;
    backendSessionToken = "";
  });
}

function resolvePackagedBackend() {
  const backendDir = path.join(process.resourcesPath, "backend");
  const namedBackend = path.join(backendDir, "KubeDeck Backend.exe");
  if (fs.existsSync(namedBackend)) return namedBackend;
  return path.join(backendDir, "kubedeck-backend.exe");
}

function writeBackendPidFile(info: BackendPidFile) {
  fs.mkdirSync(appDataRoot(), { recursive: true });
  fs.writeFileSync(backendPidPath(), JSON.stringify(info, null, 2), "utf-8");
}

function cleanupStaleBackend() {
  const stored = readStoredBackendInfo();
  if (!stored) return;
  if (!isKubeDeckBackendProcess(stored.pid, stored.tokenHash)) {
    fs.rmSync(backendPidPath(), { force: true });
    return;
  }
  logDesktop(`cleanup stale backend pid=${stored.pid}`);
  killProcessTree(stored.pid, stored.tokenHash);
  fs.rmSync(backendPidPath(), { force: true });
}

function stopBackend(reason: string) {
  if (backendStopping) return;
  backendStopping = true;
  const stored = readStoredBackendInfo();
  const pid = backendPid ?? backend?.pid ?? stored?.pid ?? null;
  const expectedTokenHash = backendSessionToken ? tokenHash(backendSessionToken) : stored?.tokenHash;
  logDesktop(`backend stop reason=${reason} pid=${pid ?? "unknown"}`);
  if (backend && !backend.killed) {
    backend.kill();
  }
  if (pid) {
    killProcessTree(pid, expectedTokenHash);
    clearBackendPidFile(pid);
  }
  backend = null;
  backendPid = null;
  backendSessionToken = "";
}

function readStoredBackendInfo(): BackendPidFile | null {
  try {
    const raw = fs.readFileSync(backendPidPath(), "utf-8").trim();
    if (!raw) return null;
    if (raw.startsWith("{")) {
      const parsed = JSON.parse(raw) as Partial<BackendPidFile>;
      if (parsed.app !== "KubeDeck Backend" || !Number.isInteger(parsed.pid) || Number(parsed.pid) <= 0) return null;
      return {
        app: "KubeDeck Backend",
        pid: Number(parsed.pid),
        startedAt: String(parsed.startedAt || ""),
        command: String(parsed.command || ""),
        tokenHash: String(parsed.tokenHash || ""),
      };
    }
    const legacyPid = Number(raw);
    return Number.isInteger(legacyPid) && legacyPid > 0
      ? { app: "KubeDeck Backend", pid: legacyPid, startedAt: "", command: "", tokenHash: "" }
      : null;
  } catch {
    return null;
  }
}

function clearBackendPidFile(expectedPid: number | null) {
  const pidFile = backendPidPath();
  if (!fs.existsSync(pidFile)) return;
  if (!expectedPid) {
    fs.rmSync(pidFile, { force: true });
    return;
  }
  const stored = readStoredBackendInfo();
  if (stored?.pid === expectedPid) fs.rmSync(pidFile, { force: true });
}

function isKubeDeckBackendProcess(pid: number, expectedTokenHash?: string) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  if (process.platform === "win32") {
    const commandLine = getWindowsProcessCommandLine(pid);
    if (!commandLine) return false;
    const normalized = commandLine.toLowerCase();
    const looksLikeBackend =
      normalized.includes("kubedeck backend") ||
      normalized.includes("kubedeck-backend") ||
      normalized.includes("kubedeck_backend.main") ||
      normalized.includes(`${path.sep}apps${path.sep}backend`.toLowerCase()) ||
      normalized.includes("resources\\backend");
    if (!looksLikeBackend) return false;
    if (expectedTokenHash && backendSessionToken && tokenHash(backendSessionToken) !== expectedTokenHash) return false;
    return true;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function getWindowsProcessCommandLine(pid: number) {
  const result = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `($p = Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}' -ErrorAction SilentlyContinue); if ($p) { $p.CommandLine }`,
    ],
    { encoding: "utf-8", windowsHide: true }
  );
  if (result.error) {
    logDesktop(`process inspection error pid=${pid} ${result.error.message}`);
    return "";
  }
  return (result.stdout || "").trim();
}

function killProcessTree(pid: number, expectedTokenHash?: string) {
  if (!isKubeDeckBackendProcess(pid, expectedTokenHash)) {
    logDesktop(`skip taskkill pid=${pid}: process is not verified as KubeDeck backend`);
    return;
  }
  if (process.platform === "win32") {
    const result = spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { encoding: "utf-8", windowsHide: true });
    if (result.error) logDesktop(`taskkill error pid=${pid} ${result.error.message}`);
    if (result.stdout?.trim()) logDesktop(`taskkill stdout ${result.stdout.trim()}`);
    if (result.stderr?.trim()) logDesktop(`taskkill stderr ${result.stderr.trim()}`);
    return;
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch (error) {
    logDesktop(`kill error pid=${pid} ${String(error)}`);
  }
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1120,
    minHeight: 720,
    backgroundColor: "#101317",
    webPreferences: {
      preload: path.join(__dirname, "../preload/preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  const devUrl = resolveDevServerUrl();
  if (devUrl) {
    await mainWindow.loadURL(devUrl);
  } else {
    await mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
  mainWindow.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    logDesktop(`renderer console level=${level} ${message} ${sourceId}:${line}`);
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://127.0.0.1:") || url.startsWith("http://localhost:")) {
      shell.openExternal(url);
      return { action: "deny" };
    }
    return { action: "deny" };
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function resolveDevServerUrl() {
  const value = process.env.VITE_DEV_SERVER_URL;
  if (!value || app.isPackaged) return "";
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(parsed.hostname)) {
      logDesktop(`ignored unsafe VITE_DEV_SERVER_URL=${value}`);
      return "";
    }
    return parsed.toString();
  } catch {
    logDesktop(`ignored invalid VITE_DEV_SERVER_URL=${value}`);
    return "";
  }
}

ipcMain.handle("kubedeck:getBackendAuth", () => ({ baseUrl: backendUrl, token: backendSessionToken }));
ipcMain.handle("kubedeck:getBackendUrl", () => backendUrl);
ipcMain.handle("kubedeck:selectKubeconfig", async () => {
  const result = await dialog.showOpenDialog({
    title: "Select kubeconfig",
    properties: ["openFile"],
    filters: [{ name: "Kubeconfig", extensions: ["yaml", "yml", "config", "*"] }],
  });
  return result.canceled ? null : result.filePaths[0];
});
ipcMain.handle("kubedeck:openLogsFolder", async () => {
  await shell.openPath(logsDir());
});

ipcMain.handle("kubedeck:openAppFolder", async (_event, folder: AppFolder) => {
  if (!["root", "logs", "config", "kubeconfigs"].includes(folder)) {
    throw new Error("Unknown KubeDeck folder");
  }
  const target = appFolderPath(folder);
  if (folder === "config") {
    if (fs.existsSync(target)) {
      shell.showItemInFolder(target);
      return;
    }
    await shell.openPath(appDataRoot());
    return;
  }
  await shell.openPath(target);
});

ipcMain.handle("kubedeck:getDesktopInfo", () => ({
  appName: app.getName(),
  appVersion: app.getVersion(),
  electronVersion: process.versions.electron ?? "",
  chromeVersion: process.versions.chrome ?? "",
  nodeVersion: process.versions.node ?? "",
  platform: process.platform,
  arch: process.arch,
  isPackaged: app.isPackaged,
  paths: {
    root: appDataRoot(),
    logs: logsDir(),
    config: configFilePath(),
    kubeconfigs: kubeconfigsDir(),
  },
}));
ipcMain.handle("kubedeck:openPodShell", async (_event, request: {
  clusterId: string;
  namespace: string;
  pod: string;
  container?: string;
}) => {
  assertSafeKubernetesName(request.namespace, "namespace");
  assertSafeKubernetesName(request.pod, "pod");
  if (request.container) assertSafeKubernetesName(request.container, "container");

  const config = await fetchBackendConfig();
  const cluster = config.clusters.find((item) => item.id === request.clusterId);
  if (!cluster) throw new Error("Cluster not found");
  const kubectlPath = config.settings.kubectlPath;
  const kubeconfigPath = cluster.kubeconfigPath;
  if (!isSafeKubectlPath(kubectlPath)) throw new Error("Unsafe kubectl path in settings");
  if (!fs.existsSync(kubeconfigPath)) throw new Error("Kubeconfig file not found");

  const dir = path.join(appDataRoot(), "terminals");
  fs.mkdirSync(dir, { recursive: true });
  cleanupOldTerminalScripts(dir);
  const scriptPath = path.join(dir, `kubedeck-shell-${Date.now()}.cmd`);
  const args = [
    quoteCmdArg(kubectlPath),
    "--kubeconfig",
    quoteCmdArg(kubeconfigPath),
    "exec",
    "-i",
    "-t",
    "-n",
    quoteCmdArg(request.namespace),
    quoteCmdArg(request.pod),
    ...(request.container ? ["-c", quoteCmdArg(request.container)] : []),
    "--",
    "sh",
    "-c",
    quoteCmdArg("clear; (bash || sh || ash)"),
  ];
  const body = [
    "@echo off",
    "chcp 65001 >nul",
    `title KubeDeck shell: ${request.namespace}/${request.pod}`,
    args.join(" "),
    "echo.",
    "echo Session closed. Press any key to exit.",
    "pause >nul",
    "",
  ].join("\r\n");
  fs.writeFileSync(scriptPath, body, "utf-8");
  const openError = await shell.openPath(scriptPath);
  if (openError) throw new Error(openError);
  logDesktop(`open pod shell cluster=${request.clusterId} namespace=${request.namespace} pod=${request.pod} container=${request.container ?? ""}`);
});

async function fetchBackendConfig(): Promise<BackendConfig> {
  if (!backendUrl || !backendSessionToken) throw new Error("Backend is not ready");
  const response = await fetch(`${backendUrl}/config`, { headers: { "X-KubeDeck-Token": backendSessionToken } });
  if (!response.ok) throw new Error(`Backend config request failed: ${response.status}`);
  return (await response.json()) as BackendConfig;
}

function isSafeKubectlPath(value: string) {
  const text = String(value || "").trim();
  if (text === "kubectl" || text === "kubectl.exe") return true;
  return ["kubectl", "kubectl.exe"].includes(path.basename(text).toLowerCase()) && fs.existsSync(text);
}

function assertSafeKubernetesName(value: string, field: string) {
  if (!/^[a-zA-Z0-9_.-]+$/.test(value)) {
    throw new Error(`Unsafe ${field} value`);
  }
}

function quoteCmdArg(value: string) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function cleanupOldTerminalScripts(dir: string) {
  const maxAgeMs = 24 * 60 * 60 * 1000;
  const now = Date.now();
  try {
    for (const entry of fs.readdirSync(dir)) {
      if (!entry.startsWith("kubedeck-shell-") || !entry.endsWith(".cmd")) continue;
      const file = path.join(dir, entry);
      const stat = fs.statSync(file);
      if (now - stat.mtimeMs > maxAgeMs) fs.rmSync(file, { force: true });
    }
  } catch (error) {
    logDesktop(`terminal script cleanup failed: ${String(error)}`);
  }
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    logDesktop("desktop startup");
    await startBackend();
    await waitForBackendReady();
    await createWindow();
  }).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    logDesktop(`startup failed: ${message}`);
    dialog.showErrorBox("KubeDeck startup failed", message);
    app.quit();
  });
}

app.on("window-all-closed", () => {
  stopBackend("window-all-closed");
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  logDesktop("desktop shutdown");
  stopBackend("before-quit");
});

app.on("will-quit", () => {
  stopBackend("will-quit");
});
