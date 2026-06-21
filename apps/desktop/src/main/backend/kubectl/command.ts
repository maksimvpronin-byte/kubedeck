import fs from "node:fs";

export const DEFAULT_MAX_OUTPUT_BYTES = 32 * 1024 * 1024;

export interface KubectlCommand {
  clusterId: string;
  kubeconfigPath?: string | null;
  kubectlPath: string;
  args: string[];
  timeoutSeconds: number;
  maxOutputBytes: number;
}

export interface BuiltKubectlCommand {
  executable: string;
  args: string[];
  preview: string;
  environment: NodeJS.ProcessEnv;
}

export function createKubectlCommand(
  values: Omit<Partial<KubectlCommand>, "args"> & Pick<KubectlCommand, "args">,
): KubectlCommand {
  return {
    clusterId: values.clusterId ?? "",
    kubeconfigPath: values.kubeconfigPath ?? null,
    kubectlPath: values.kubectlPath ?? "kubectl",
    args: [...values.args],
    timeoutSeconds: values.timeoutSeconds ?? 30,
    maxOutputBytes: values.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
  };
}

function hasRequestTimeout(args: string[]): boolean {
  return args.some((arg) => arg === "--request-timeout" || arg.startsWith("--request-timeout="));
}

function quotePreviewArg(arg: string): string {
  if (!arg || /\s|["'&|<>]/.test(arg)) {
    return `"${arg.replaceAll('"', '\\"')}"`;
  }
  return arg;
}

function mergeNoProxy(existing: string, additions: string[]): string {
  const values: string[] = [];
  const seen = new Set<string>();

  for (const item of [...existing.split(","), ...additions]) {
    const value = item.trim();
    const key = value.toLowerCase();
    if (value && !seen.has(key)) {
      seen.add(key);
      values.push(value);
    }
  }

  return values.join(",");
}

function kubeconfigServerHost(kubeconfigPath?: string | null): string {
  if (!kubeconfigPath) return "";

  try {
    const text = fs.readFileSync(kubeconfigPath, "utf8");
    const match = text.match(/^\s*server:\s*["']?([^"'#\s]+)["']?\s*(?:#.*)?$/m);
    if (!match) return "";
    return new URL(match[1]).hostname;
  } catch {
    return "";
  }
}

export function kubectlEnvironment(kubeconfigPath?: string | null): NodeJS.ProcessEnv {
  const environment = { ...process.env };
  const additions = [
    "localhost",
    "127.0.0.1",
    "::1",
    "10.0.0.0/8",
    "172.16.0.0/12",
    "192.168.0.0/16",
  ];

  const serverHost = kubeconfigServerHost(kubeconfigPath);
  if (serverHost) additions.push(serverHost);

  const existing = environment.NO_PROXY ?? environment.no_proxy ?? "";
  const merged = mergeNoProxy(existing, additions);
  environment.NO_PROXY = merged;
  environment.no_proxy = merged;
  return environment;
}

export function buildKubectlCommand(command: KubectlCommand): BuiltKubectlCommand {
  const args: string[] = [];

  if (command.kubeconfigPath) {
    args.push("--kubeconfig", command.kubeconfigPath);
  }

  if (command.timeoutSeconds > 0 && !hasRequestTimeout(command.args)) {
    const requestTimeout = Math.max(
      5,
      Math.min(command.timeoutSeconds, Math.max(5, command.timeoutSeconds - 5)),
    );
    args.push(`--request-timeout=${requestTimeout}s`);
  }

  args.push(...command.args);

  return {
    executable: command.kubectlPath,
    args,
    preview: [command.kubectlPath, ...args].map(quotePreviewArg).join(" "),
    environment: kubectlEnvironment(command.kubeconfigPath),
  };
}
