import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, nativeTheme, shell } from "electron";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startGateway } from "./backend/gateway";
import type { GatewayHandle } from "./backend/types";
import { ElectronSafeStorageSecretStore } from "./security/electronSafeStorageSecretStore";
import { migratePlaintextLlmSecret } from "./backend/security/migrateSecrets";

let mainWindow: BrowserWindow | null = null;
let gatewayUrl = "";
let gateway: GatewayHandle | null = null;
let gatewaySessionToken = "";
let gatewayReady: Promise<void> | null = null;
let gatewayShutdown: Promise<void> | null = null;
let quitAfterGatewayShutdown = false;

type AppFolder = "root" | "logs" | "config" | "kubeconfigs";

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
  const secretStore = new ElectronSafeStorageSecretStore(appDataRoot());
  const migration = migratePlaintextLlmSecret(appDataRoot(), secretStore);
  if (migration.blocked) {
    logDesktop("LLM secret migration blocked: encrypted storage unavailable, plaintext key permissions tightened");
  } else if (migration.migrated) {
    logDesktop("LLM secret migration completed: API key moved to encrypted storage");
  }
  gateway = await startGateway({
    sessionToken: gatewaySessionToken,
    appDataRoot: appDataRoot(),
    appVersion: app.getVersion(),
    log: logDesktop,
    secretStore,
  });
  gatewayUrl = gateway.baseUrl;
}

function stopNodeGateway(reason: string): Promise<void> {
  if (gatewayShutdown) return gatewayShutdown;
  if (!gateway) return Promise.resolve();
  logDesktop(`node gateway stop reason=${reason}`);
  const current = gateway;
  gateway = null;
  gatewayUrl = "";
  gatewayShutdown = current.close().catch((error: unknown) => {
    logDesktop(`node gateway stop failed: ${String(error)}`);
  });
  return gatewayShutdown;
}
// Windows takes the window, taskbar and Alt+Tab icon from the running
// executable unless the window carries its own icon, so the packaged app used
// to show the default Electron icon even though the artifact had ours.
function resolveWindowIcon() {
  const iconPath = path.join(__dirname, "../../assets", process.platform === "win32" ? "icon.ico" : "icon-512.png");
  try {
    const image = nativeImage.createFromPath(iconPath);
    if (!image.isEmpty()) return image;
    logDesktop(`window icon is empty: ${iconPath}`);
  } catch (error) {
    logDesktop(`window icon could not be loaded: ${String(error)}`);
  }
  return undefined;
}

// The window paints its own background before the page exists, and it now does
// that while the gateway is still starting - so a fixed dark grey was a flash of
// the wrong colour for everyone not on a dark theme. These are the backgrounds
// of `renderer/public/boot-screen.js`, which paints next; the two lists are held
// together by tests/boot-screen.contract.test.cjs.
const THEME_BACKGROUNDS: Record<string, string> = {
  midnight: "#18212b",
  graphite: "#20252b",
  nord: "#242b38",
  forest: "#172623",
  plum: "#25212b",
  mocha: "#29231f",
  light: "#eef3f8",
};

function windowBackgroundColor() {
  let theme = "system";
  try {
    const stored = JSON.parse(fs.readFileSync(path.join(appDataRoot(), "config.json"), "utf-8"))?.settings?.theme;
    if (typeof stored === "string") theme = stored === "dark" ? "midnight" : stored;
  } catch {
    // No settings yet, or they are unreadable: the system theme decides.
  }
  return THEME_BACKGROUNDS[theme] ?? (nativeTheme.shouldUseDarkColors ? THEME_BACKGROUNDS.midnight : THEME_BACKGROUNDS.light);
}

async function createWindow() {
  const icon = resolveWindowIcon();
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1120,
    minHeight: 720,
    backgroundColor: windowBackgroundColor(),
    ...(icon ? { icon } : {}),
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
    if (target.protocol === "file:") return !devUrl && fileURLToPath(target) === path.join(__dirname, "../renderer/index.html");
    if (!devUrl) return false;
    const developmentOrigin = new URL(devUrl).origin;
    return target.origin === developmentOrigin;
  } catch {
    return false;
  }
}

// The window is now opened while the gateway is still starting, so the first
// call from the renderer can arrive before there is an address to hand back.
ipcMain.handle("kubedeck:getBackendAuth", async () => {
  if (gatewayReady) await gatewayReady;
  return { baseUrl: gatewayUrl, token: gatewaySessionToken };
});
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
// Without an explicit AppUserModelID Windows groups the window under the host
// process, which shows the wrong taskbar icon and breaks pinning. The value
// must stay in sync with `appId` in electron-builder.yml.
if (process.platform === "win32") {
  app.setAppUserModelId("dev.kubedeck.app");
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

  app
    .whenReady()
    .then(async () => {
      Menu.setApplicationMenu(null);
      logDesktop("desktop startup");
      // Starting the gateway first meant nothing at all was on screen until it
      // was listening. The window now opens alongside it and shows the boot
      // screen from `renderer/public/boot-screen.js`, which waits on the same
      // promise through `kubedeck:getBackendAuth`.
      gatewayReady = startNodeGateway();
      await Promise.all([gatewayReady, createWindow()]);
    })
    .catch((error) => {
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
  app.quit();
});

app.on("before-quit", (event) => {
  if (quitAfterGatewayShutdown) return;
  event.preventDefault();
  logDesktop("desktop shutdown");
  void stopNodeGateway("before-quit").finally(() => {
    quitAfterGatewayShutdown = true;
    app.quit();
  });
});
