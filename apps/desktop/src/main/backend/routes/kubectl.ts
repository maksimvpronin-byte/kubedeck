import type { ServerResponse } from "node:http";
import type { ConfigStore } from "../config/configStore";
import { buildKubectlCommand, createKubectlCommand } from "../kubectl/command";
import { KubectlError, writeKubectlError } from "../kubectl/errors";
import type { KubectlRunner } from "../kubectl/runner";
import { writeError } from "../errors";
import { writeJson } from "../http";

export async function writeKubectlStatus(
  response: ServerResponse,
  configStore: ConfigStore,
  runner: KubectlRunner,
): Promise<void> {
  const config = configStore.load();
  const command = createKubectlCommand({
    clusterId: "",
    kubeconfigPath: null,
    kubectlPath: config.settings.kubectlPath,
    args: ["version", "--client", "-o", "json"],
    timeoutSeconds: 15,
    maxOutputBytes: 4 * 1024 * 1024,
  });

  try {
    const result = await runner.runJson(command);
    writeJson(response, {
      ok: true,
      version: result.clientVersion ?? result,
      commandPreview: buildKubectlCommand(command).preview,
    });
  } catch (error) {
    if (error instanceof KubectlError) {
      writeKubectlError(response, error);
      return;
    }

    writeError(response, 500, "KUBECTL_STATUS_FAILED", "Unable to read kubectl status");
  }
}
