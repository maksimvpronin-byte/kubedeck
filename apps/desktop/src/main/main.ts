import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from "electron";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { startGateway } from "./backend/gateway";
import type { GatewayHandle } from "./backend/types";

let mainWindow: BrowserWindow | null = null;
let gatewayUrl = "";
let gateway: GatewayHandle | null = null;
let gatewaySessionToken = "";


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

async function startNodeGateway() {
  if (gateway) return;

  gatewaySessionToken = randomBytes(32).toString("base64url");
  gateway = await startGateway({
    sessionToken: gatewaySessionToken,
    appDataRoot: appDataRoot(),
    appVersion: app.getVersion(),
    log: logDesktop,
  });
  gatewayUrl = gateway.baseUrl;
}

function stopNodeGateway(reason: string) {
  if (!gateway) return;
  logDesktop(`node gateway stop reason=${reason}`);
  const current = gateway;
  gateway = null;
  gatewayUrl = "";
  void current.close().catch((error: unknown) => {
    logDesktop(`node gateway stop failed: ${String(error)}`);
  });
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
      sandbox: true,
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
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!isAllowedRendererNavigation(url, devUrl)) event.preventDefault();
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

function isAllowedRendererNavigation(url: string, devUrl: string) {
  try {
    const target = new URL(url);
    if (target.protocol === "file:") return !devUrl && app.isPackaged;
    if (!devUrl) return false;
    const developmentOrigin = new URL(devUrl).origin;
    return target.origin === developmentOrigin;
  } catch {
    return false;
  }
}

ipcMain.handle("kubedeck:getBackendAuth", () => ({ baseUrl: gatewayUrl, token: gatewaySessionToken }));
ipcMain.handle("kubedeck:getBackendUrl", () => gatewayUrl);
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
ipcMain.handle("kubedeck:openPodShell", async (_event, rawRequest: unknown) => {
  if (!rawRequest || typeof rawRequest !== "object") throw new Error("Invalid pod shell request");
  const request = rawRequest as Record<string, unknown>;
  if (typeof request.clusterId !== "string" || typeof request.namespace !== "string" || typeof request.pod !== "string") {
    throw new Error("Invalid pod shell request");
  }
  if (request.container !== undefined && typeof request.container !== "string") throw new Error("Invalid pod shell container");
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
  if (process.platform !== "win32" && process.platform !== "darwin") {
    throw new Error("External Pod Shell is supported only on Windows and macOS");
  }

  const isMac = process.platform === "darwin";
  const scriptPath = path.join(
    dir,
    `kubedeck-shell-${Date.now()}${isMac ? ".command" : ".cmd"}`,
  );

  if (isMac) {
    const args = [
      quotePosixArg(kubectlPath),
      "--kubeconfig",
      quotePosixArg(kubeconfigPath),
      "exec",
      "-i",
      "-t",
      "-n",
      quotePosixArg(request.namespace),
      quotePosixArg(request.pod),
      ...(request.container ? ["-c", quotePosixArg(request.container)] : []),
      "--",
      "sh",
      "-c",
      quotePosixArg("clear; (bash || sh || ash)"),
    ];
    const body = [
      "#!/bin/zsh",
      "clear",
      `printf '\\033]0;KubeDeck shell: ${request.namespace}/${request.pod}\\007'`,
      args.join(" "),
      "status=$?",
      "echo",
      'echo "Session closed."',
      'printf "Press Enter to exit..."',
      "read -r",
      'exit "$status"',
      "",
    ].join("\n");
    fs.writeFileSync(scriptPath, body, "utf-8");
    fs.chmodSync(scriptPath, 0o700);
  } else {
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
  }
  const openError = await shell.openPath(scriptPath);
  if (openError) throw new Error(openError);
  logDesktop(`open pod shell cluster=${request.clusterId} namespace=${request.namespace} pod=${request.pod} container=${request.container ?? ""}`);
});

async function fetchBackendConfig(): Promise<BackendConfig> {
  if (!gatewayUrl || !gatewaySessionToken) throw new Error("Backend is not ready");
  const response = await fetch(`${gatewayUrl}/config`, { headers: { "X-KubeDeck-Token": gatewaySessionToken } });
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

function quotePosixArg(value: string) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function cleanupOldTerminalScripts(dir: string) {
  const maxAgeMs = 24 * 60 * 60 * 1000;
  const now = Date.now();
  try {
    for (const entry of fs.readdirSync(dir)) {
      if (
        !entry.startsWith("kubedeck-shell-") ||
        (!entry.endsWith(".cmd") && !entry.endsWith(".command"))
      ) continue;
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
    await startNodeGateway();
    await createWindow();
  }).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    logDesktop(`startup failed: ${message}`);
    dialog.showErrorBox("KubeDeck startup failed", message);
    app.quit();
  });
}

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length > 0) return;
  void createWindow().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    logDesktop(`window activation failed: ${message}`);
    dialog.showErrorBox("KubeDeck window failed", message);
  });
});

app.on("window-all-closed", () => {
  if (process.platform === "darwin") return;
  stopNodeGateway("window-all-closed");
  app.quit();
});

app.on("before-quit", () => {
  logDesktop("desktop shutdown");
  stopNodeGateway("before-quit");
});

app.on("will-quit", () => {
  stopNodeGateway("will-quit");
});
