// Answers `kubectl get --raw <path>` without starting kubectl.
//
// The runner asks this first for every command. A raw GET on a cluster whose
// kubeconfig is understood (`connectionProfile`) goes straight to the API
// server over that cluster's kept connection; anything else - another verb, a
// kubeconfig feature not handled here, a TLS or proxy setup Node disagrees
// with Go about - returns to kubectl, which answers exactly as it always did.

import path from "node:path";
import { type KubectlCommand, kubectlEnvironment } from "../kubectl/command";
import type { CommandResult } from "../kubectl/runner";
import { ClusterApi, DirectApiUnavailable } from "./clusterApi";
import { ExecCredentialCache } from "./execCredentials";
import { connectionProfile } from "./kubeconfigProfile";

interface ClientEntry {
  stamp: string;
  api: ClusterApi;
}

// The path of a raw GET, or null for anything else.
export function rawGetPath(args: readonly string[]): string | null {
  if (args.length === 3 && args[0] === "get" && args[1] === "--raw") return args[2].startsWith("/") ? args[2] : null;
  if (args.length === 2 && args[0] === "get" && args[1].startsWith("--raw=/")) return args[1].slice("--raw=".length);
  return null;
}

export class DirectApiTransport {
  private readonly clients = new Map<string, ClientEntry>();
  // Kubeconfigs (by profile stamp) this transport gave up on: kubectl answers
  // for them until the file changes, instead of every request failing over.
  private readonly refused = new Map<string, string>();
  private readonly execCredentials: ExecCredentialCache;

  constructor(private readonly log: (message: string) => void) {
    this.execCredentials = new ExecCredentialCache(log);
  }

  // The cluster's client, or null when kubectl has to answer for it.
  client(kubeconfigPath: string | null | undefined): ClusterApi | null {
    if (!kubeconfigPath) return null;
    const result = connectionProfile(kubeconfigPath);
    if (!result.profile) {
      this.refuse(kubeconfigPath, `unsupported:${result.reason}`, result.reason);
      return null;
    }
    const { profile } = result;
    if (this.refused.get(kubeconfigPath) === profile.stamp) return null;
    this.refused.delete(kubeconfigPath);
    const existing = this.clients.get(kubeconfigPath);
    if (existing && existing.stamp === profile.stamp) return existing.api;
    existing?.api.close();
    try {
      const api = new ClusterApi(profile, kubectlEnvironment(kubeconfigPath), this.execCredentials);
      this.clients.set(kubeconfigPath, { stamp: profile.stamp, api });
      return api;
    } catch (error) {
      this.clients.delete(kubeconfigPath);
      if (error instanceof DirectApiUnavailable) {
        this.refuse(kubeconfigPath, profile.stamp, error.message);
        return null;
      }
      throw error;
    }
  }

  private refuse(kubeconfigPath: string, stamp: string, reason: string): void {
    if (this.refused.get(kubeconfigPath) === stamp) return;
    this.refused.set(kubeconfigPath, stamp);
    this.log(`node api using kubectl for ${path.basename(kubeconfigPath)}: ${reason}`);
  }

  // Remembers that this kubeconfig needs kubectl, after a failure kubectl
  // might not share.
  giveUp(api: ClusterApi, kubeconfigPath: string, reason: string): void {
    const entry = this.clients.get(kubeconfigPath);
    if (entry?.api === api) {
      api.close();
      this.clients.delete(kubeconfigPath);
    }
    this.refuse(kubeconfigPath, api.profile.stamp, reason);
  }

  // The command's result, or null when kubectl has to run it.
  async run(command: KubectlCommand, signal?: AbortSignal): Promise<CommandResult | null> {
    if (command.directApi !== true || typeof command.stdinText === "string") return null;
    const apiPath = rawGetPath(command.args);
    if (!apiPath || !command.kubeconfigPath) return null;
    const api = this.client(command.kubeconfigPath);
    if (!api) return null;
    const preview = `GET ${api.url(apiPath).href}`;
    const started = Date.now();
    try {
      const stdout = await api.get(apiPath, { timeoutSeconds: command.timeoutSeconds, maxBytes: command.maxOutputBytes, signal, preview });
      this.log(`node api ${preview} ok bytes=${stdout.length} ms=${Date.now() - started}`);
      return { ok: true, stdout, stderr: "", commandPreview: preview, returnCode: 0 };
    } catch (error) {
      if (error instanceof DirectApiUnavailable) {
        this.giveUp(api, command.kubeconfigPath, error.message);
        return null;
      }
      const code = (error as { info?: { code?: string } }).info?.code ?? "unknown";
      if (code !== "KUBECTL_CANCELLED") this.log(`node api ${preview} failed code=${code} ms=${Date.now() - started}`);
      throw error;
    }
  }

  clear(): void {
    for (const entry of this.clients.values()) entry.api.close();
    this.clients.clear();
    this.refused.clear();
    this.execCredentials.clear();
  }

  close(): void {
    this.clear();
  }
}
