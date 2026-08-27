import fs from "node:fs";

export const DEFAULT_MAX_OUTPUT_BYTES = 32 * 1024 * 1024;

export interface KubectlCommand {
  clusterId: string;
  kubeconfigPath?: string | null;
  kubectlPath: string;
  args: string[];
  timeoutSeconds: number;
  maxOutputBytes: number;
  stdinText?: string;
}

export interface BuiltKubectlCommand {
  executable: string;
  args: string[];
  preview: string;
  environment: NodeJS.ProcessEnv;
}

export function createKubectlCommand(values: Omit<Partial<KubectlCommand>, "args"> & Pick<KubectlCommand, "args">): KubectlCommand {
  return {
    clusterId: values.clusterId ?? "",
    kubeconfigPath: values.kubeconfigPath ?? null,
    kubectlPath: values.kubectlPath ?? "kubectl",
    args: [...values.args],
    timeoutSeconds: values.timeoutSeconds ?? 30,
    maxOutputBytes: values.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
    ...(typeof values.stdinText === "string" ? { stdinText: values.stdinText } : {}),
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

interface EnvironmentCacheEntry {
  mtimeMs: number;
  size: number;
  noProxySource: string;
  environment: NodeJS.ProcessEnv;
}

// Every kubectl invocation used to read the kubeconfig from disk to find the
// API server host, and copy the whole of `process.env` to hold two proxy
// variables. A nodes table warms one kubelet request per node, so a wide
// cluster paid for both, a hundred times over, on the thread that also serves
// the gateway.
const environmentCache = new Map<string, EnvironmentCacheEntry>();

// -1 for a file that is not there: an appearing kubeconfig has to invalidate
// the entry the same way a rewritten one does.
function kubeconfigStamp(kubeconfigPath: string): { mtimeMs: number; size: number } {
  if (!kubeconfigPath) return { mtimeMs: 0, size: 0 };
  try {
    const stat = fs.statSync(kubeconfigPath);
    return { mtimeMs: stat.mtimeMs, size: stat.size };
  } catch {
    return { mtimeMs: -1, size: -1 };
  }
}

export function kubectlEnvironment(kubeconfigPath?: string | null): NodeJS.ProcessEnv {
  const key = kubeconfigPath ?? "";
  // The proxy settings of the process are what the merge starts from, so a
  // change to them has to be noticed - reading the two variables is nothing
  // next to copying the environment they live in.
  const noProxySource = process.env.NO_PROXY ?? process.env.no_proxy ?? "";
  const stamp = kubeconfigStamp(key);
  const cached = environmentCache.get(key);
  if (cached && cached.mtimeMs === stamp.mtimeMs && cached.size === stamp.size && cached.noProxySource === noProxySource) {
    return cached.environment;
  }

  const environment = { ...process.env };
  const additions = ["localhost", "127.0.0.1", "::1", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"];

  const serverHost = kubeconfigServerHost(key);
  if (serverHost) additions.push(serverHost);

  const merged = mergeNoProxy(noProxySource, additions);
  environment.NO_PROXY = merged;
  environment.no_proxy = merged;
  // Handed out as-is to every caller: the environment goes straight into
  // `spawn`, and the one caller that needs a different PATH (the pod terminal)
  // already builds its own object from it rather than writing into this one.
  environmentCache.set(key, { ...stamp, noProxySource, environment });
  return environment;
}

// Only the process environment itself is beyond what the cache can notice; it
// is fixed at start-up in the application, and tests that change it reset the
// cache through this.
export function clearKubectlEnvironmentCache(): void {
  environmentCache.clear();
}

export function buildKubectlCommand(command: KubectlCommand): BuiltKubectlCommand {
  const args: string[] = [];

  if (command.kubeconfigPath) {
    args.push("--kubeconfig", command.kubeconfigPath);
  }

  if (command.timeoutSeconds > 0 && !hasRequestTimeout(command.args)) {
    const requestTimeout = Math.max(5, Math.min(command.timeoutSeconds, Math.max(5, command.timeoutSeconds - 5)));
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
