import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface AppPaths {
  root: string;
  config: string;
  kubeconfigs: string;
  logs: string;
}

export function defaultAppDataRoot(): string {
  const appData = String(process.env.APPDATA ?? "").trim();
  return appData ? path.join(appData, "KubeDeck") : path.join(os.homedir(), ".kubedeck");
}

export function ensureAppPaths(rootOverride?: string): AppPaths {
  const root = path.resolve(rootOverride || defaultAppDataRoot());
  const kubeconfigs = path.join(root, "kubeconfigs");
  const logs = path.join(root, "logs");

  for (const directory of [root, kubeconfigs, logs]) {
    fs.mkdirSync(directory, { recursive: true });
  }

  return {
    root,
    config: path.join(root, "config.json"),
    kubeconfigs,
    logs,
  };
}
