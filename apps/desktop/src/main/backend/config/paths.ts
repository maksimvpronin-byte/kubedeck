import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface AppPaths {
  root: string;
  config: string;
  kubeconfigs: string;
  knownHosts: string;
  logs: string;
  metrics: string;
}

export function defaultAppDataRoot(): string {
  const appData = String(process.env.APPDATA ?? "").trim();
  return appData ? path.join(appData, "KubeDeck") : path.join(os.homedir(), ".kubedeck");
}

export function ensureAppPaths(rootOverride?: string): AppPaths {
  const root = path.resolve(rootOverride || defaultAppDataRoot());
  const kubeconfigs = path.join(root, "kubeconfigs");
  const logs = path.join(root, "logs");
  const metrics = path.join(root, "metrics");

  for (const directory of [root, kubeconfigs, logs, metrics]) {
    fs.mkdirSync(directory, { recursive: true });
  }

  return {
    root,
    config: path.join(root, "config.json"),
    kubeconfigs,
    knownHosts: path.join(root, "hostkeys.json"),
    logs,
    metrics,
  };
}
