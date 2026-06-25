import fs from "node:fs";
import type { ConfigStore } from "../config/configStore";
import { createKubectlCommand, type KubectlCommand } from "./command";

export function clusterCommand(
  configStore: ConfigStore,
  clusterId: string,
  args: string[],
  timeoutSeconds = 30,
  maxOutputBytes = 64 * 1024 * 1024,
): KubectlCommand {
  const config = configStore.load();
  const cluster = configStore.getCluster(clusterId, config);

  return createKubectlCommand({
    clusterId,
    kubeconfigPath: cluster.kubeconfigPath,
    kubectlPath: config.settings.kubectlPath,
    args,
    timeoutSeconds,
    maxOutputBytes,
  });
}

export function kubeconfigAvailable(pathname: string): boolean {
  try {
    return fs.statSync(pathname).isFile();
  } catch {
    return false;
  }
}
