import os from "node:os";
import type { ServerResponse } from "node:http";
import type { ConfigStore } from "../config/configStore";
import { writeJson } from "../http";
import type { GatewayOptions } from "../types";

export function writeAppInfo(
  response: ServerResponse,
  options: GatewayOptions,
  configStore: ConfigStore,
): void {
  const config = configStore.load();

  writeJson(response, {
    service: "kubedeck-backend",
    backendVersion: options.appVersion,
    pythonVersion: "",
    nodeVersion: process.versions.node,
    runtime: "node",
    platform: `${os.type()} ${os.release()} ${os.arch()}`,
    processId: process.pid,
    paths: {
      root: configStore.paths.root,
      config: configStore.paths.config,
      kubeconfigs: configStore.paths.kubeconfigs,
      logs: configStore.paths.logs,
    },
    settings: {
      kubectlPath: config.settings.kubectlPath,
      refreshIntervalSeconds: config.settings.refreshIntervalSeconds,
      logsTailLines: config.settings.logsTailLines,
      language: config.settings.language,
      theme: config.settings.theme,
      ssh: config.settings.ssh,
    },
    clusters: config.clusters.length,
  });
}
