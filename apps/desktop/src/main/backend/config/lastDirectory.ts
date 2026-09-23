import fs from "node:fs";
import path from "node:path";

// Where the kubeconfig picker opened a file last time, kept beside config.json.
// Adding the second and third cluster from the same folder of kubeconfigs used
// to start from the default folder every time.
const FILE_NAME = "dialog-state.json";

export function readLastKubeconfigDirectory(appDataRoot: string): string | undefined {
  try {
    const stored = JSON.parse(fs.readFileSync(path.join(appDataRoot, FILE_NAME), "utf8"))?.kubeconfigDirectory;
    return typeof stored === "string" && stored && fs.statSync(stored).isDirectory() ? stored : undefined;
  } catch {
    return undefined;
  }
}

export function rememberKubeconfigDirectory(appDataRoot: string, filePath: string): void {
  try {
    fs.mkdirSync(appDataRoot, { recursive: true });
    fs.writeFileSync(path.join(appDataRoot, FILE_NAME), `${JSON.stringify({ kubeconfigDirectory: path.dirname(filePath) }, null, 2)}\n`, "utf8");
  } catch {
    // Remembering the folder is a convenience; a read-only profile must not
    // turn picking a file into an error.
  }
}
