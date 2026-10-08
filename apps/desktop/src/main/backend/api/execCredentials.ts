// Credentials from a kubeconfig `exec` plugin (kubelogin, cloud CLIs), run once
// and kept until they expire.
//
// Every kubectl process runs the plugin again: on a cluster behind kubelogin a
// table refresh was two process starts, not one. Here the plugin runs once per
// credential lifetime, concurrent requests wait for the same run, and a 401
// drops the credential so the next request runs the plugin again.

import { spawn } from "node:child_process";
import path from "node:path";
import type { ExecClusterInfo, ExecConfig } from "./kubeconfigProfile";

const EXEC_TIMEOUT_MS = 5 * 60_000;
const EXEC_MAX_OUTPUT_BYTES = 1024 * 1024;
// A credential is replaced this long before it says it expires, so a request
// never leaves with a token that dies on the way.
const EXPIRY_MARGIN_MS = 30_000;

export interface ExecCredential {
  token: string | null;
  cert: string | null;
  key: string | null;
  // Epoch ms, or null when the plugin gave no expiry: kept until a 401.
  expiresAt: number | null;
}

export class ExecPluginError extends Error {}

interface Entry {
  credential?: ExecCredential;
  running?: Promise<ExecCredential>;
}

function commandPath(exec: ExecConfig): string {
  // As in client-go: a relative command that names a path is relative to the
  // kubeconfig; a bare name is looked up on PATH.
  if (!path.isAbsolute(exec.command) && /[\\/]/.test(exec.command)) return path.resolve(exec.kubeconfigDir, exec.command);
  return exec.command;
}

function execInfo(exec: ExecConfig, cluster: ExecClusterInfo): string {
  const spec: Record<string, unknown> = { interactive: false };
  if (exec.provideClusterInfo) spec.cluster = cluster;
  return JSON.stringify({ apiVersion: exec.apiVersion, kind: "ExecCredential", spec });
}

function parseCredential(stdout: string, exec: ExecConfig): ExecCredential {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new ExecPluginError("exec plugin did not print an ExecCredential");
  }
  const record = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  if (record.kind !== "ExecCredential") throw new ExecPluginError("exec plugin did not print an ExecCredential");
  if (typeof record.apiVersion === "string" && record.apiVersion !== exec.apiVersion) throw new ExecPluginError(`exec plugin answered ${record.apiVersion}, asked ${exec.apiVersion}`);
  const status = record.status && typeof record.status === "object" ? (record.status as Record<string, unknown>) : {};
  const token = typeof status.token === "string" && status.token ? status.token : null;
  const cert = typeof status.clientCertificateData === "string" && status.clientCertificateData ? status.clientCertificateData : null;
  const key = typeof status.clientKeyData === "string" && status.clientKeyData ? status.clientKeyData : null;
  if (!token && !(cert && key)) throw new ExecPluginError("exec plugin returned neither a token nor a client certificate");
  const expiry = typeof status.expirationTimestamp === "string" ? Date.parse(status.expirationTimestamp) : Number.NaN;
  return { token, cert, key, expiresAt: Number.isFinite(expiry) ? expiry : null };
}

function runPlugin(exec: ExecConfig, cluster: ExecClusterInfo, environment: NodeJS.ProcessEnv): Promise<ExecCredential> {
  return new Promise((resolve, reject) => {
    const env: NodeJS.ProcessEnv = { ...environment, KUBERNETES_EXEC_INFO: execInfo(exec, cluster) };
    for (const item of exec.env) if (item.name) env[item.name] = item.value;
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(commandPath(exec), exec.args, { shell: false, windowsHide: true, env, stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      reject(new ExecPluginError(`exec plugin could not start: ${error instanceof Error ? error.message : String(error)}`));
      return;
    }
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;
    const finish = (error: Error | null, credential?: ExecCredential) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) {
        if (child.exitCode === null) child.kill();
        reject(error);
      } else if (credential) resolve(credential);
    };
    const timer = setTimeout(() => finish(new ExecPluginError("exec plugin did not finish in time")), EXEC_TIMEOUT_MS);
    child.stdout?.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > EXEC_MAX_OUTPUT_BYTES) finish(new ExecPluginError("exec plugin output is too large"));
      else chunks.push(chunk);
    });
    // stderr is where plugins talk to the user; it is drained, not kept.
    child.stderr?.resume();
    child.on("error", (error) => finish(new ExecPluginError(`exec plugin could not start: ${error.message}`)));
    child.on("close", (code) => {
      if (code !== 0) {
        finish(new ExecPluginError(`exec plugin exited with code ${code}`));
        return;
      }
      try {
        finish(null, parseCredential(Buffer.concat(chunks).toString("utf8"), exec));
      } catch (error) {
        finish(error instanceof Error ? error : new ExecPluginError(String(error)));
      }
    });
  });
}

export class ExecCredentialCache {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly log: (message: string) => void,
    private readonly now: () => number = Date.now,
    private readonly run: typeof runPlugin = runPlugin,
  ) {}

  private keyOf(exec: ExecConfig, cluster: ExecClusterInfo): string {
    return JSON.stringify([exec, cluster]);
  }

  async get(exec: ExecConfig, cluster: ExecClusterInfo, environment: NodeJS.ProcessEnv): Promise<ExecCredential> {
    const key = this.keyOf(exec, cluster);
    const entry = this.entries.get(key) ?? {};
    this.entries.set(key, entry);
    const current = entry.credential;
    if (current && (current.expiresAt === null || current.expiresAt - EXPIRY_MARGIN_MS > this.now())) return current;
    if (entry.running) return entry.running;
    const started = this.now();
    const running = this.run(exec, cluster, environment)
      .then((credential) => {
        if (entry.running === running) entry.credential = credential;
        this.log(
          `node api exec credential command=${path.basename(exec.command)} ms=${this.now() - started} expires=${credential.expiresAt === null ? "none" : new Date(credential.expiresAt).toISOString()}`,
        );
        return credential;
      })
      .finally(() => {
        if (entry.running === running) entry.running = undefined;
      });
    entry.running = running;
    return running;
  }

  // The server refused this credential: the next request asks the plugin again.
  invalidate(exec: ExecConfig, cluster: ExecClusterInfo, credential: ExecCredential): void {
    const entry = this.entries.get(this.keyOf(exec, cluster));
    if (entry?.credential === credential) entry.credential = undefined;
  }

  clear(): void {
    this.entries.clear();
  }
}
