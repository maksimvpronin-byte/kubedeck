// Answers `kubectl get --raw <path>` without starting kubectl.
//
// The runner asks this first for every command. A raw GET on a cluster whose
// kubeconfig is understood (`connectionProfile`) goes straight to the API
// server over that cluster's kept connection; anything else - another verb, a
// kubeconfig feature not handled here, a TLS or proxy setup Node disagrees
// with Go about - returns to kubectl, which answers exactly as it always did.

import path from "node:path";
import { type KubectlCommand, kubectlEnvironment } from "../kubectl/command";
import { KubectlError } from "../kubectl/errors";
import { type CommandResult, parseJsonOutput } from "../kubectl/runner";
import { forgetCustomListEndpoint, resolveEndpointWith } from "../resources/customListPaths";
import { builtInEndpoint, withItemTypes } from "../resources/rawListPaths";
import { ClusterApi, DirectApiUnavailable } from "./clusterApi";
import { AGGREGATED_DISCOVERY_ACCEPT, apiResourcesTable, isApiResourcesCommand } from "./discoveryTable";
import { ExecCredentialCache } from "./execCredentials";
import { type GetJsonRequest, getJsonPath, parseGetJson, type ResolvedEndpoint } from "./getTranslation";
import { ApiInformer, type InformerCallbacks } from "../watch/apiInformer";
import type { ApiWatchSource } from "../watch/watchManager";
import { connectionProfile } from "./kubeconfigProfile";

const DISCOVERY_TIMEOUT_SECONDS = 15;
const DISCOVERY_MAX_OUTPUT_BYTES = 4 * 1024 * 1024;

// A 404 for a path the server does not serve at all, as opposed to a named
// object that does not exist ("pods \"x\" not found").
function isMissingPath(error: unknown): boolean {
  return error instanceof KubectlError && error.info.code === "NOT_FOUND" && error.info.rawStderr.includes("could not find the requested resource");
}

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

export class DirectApiTransport implements ApiWatchSource {
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

  private async request(api: ClusterApi, kubeconfigPath: string, apiPath: string, command: KubectlCommand, signal?: AbortSignal): Promise<{ stdout: string; preview: string } | null> {
    const preview = `GET ${api.url(apiPath).href}`;
    const started = Date.now();
    try {
      const stdout = await api.get(apiPath, { timeoutSeconds: command.timeoutSeconds, maxBytes: command.maxOutputBytes, signal, preview });
      this.log(`node api ${preview} ok bytes=${stdout.length} ms=${Date.now() - started}`);
      return { stdout, preview };
    } catch (error) {
      if (error instanceof DirectApiUnavailable) {
        this.giveUp(api, kubeconfigPath, error.message);
        return null;
      }
      const code = (error as { info?: { code?: string } }).info?.code ?? "unknown";
      if (code !== "KUBECTL_CANCELLED") this.log(`node api ${preview} failed code=${code} ms=${Date.now() - started}`);
      throw error;
    }
  }

  private usable(command: KubectlCommand): { api: ClusterApi; kubeconfigPath: string } | null {
    if (command.directApi !== true || typeof command.stdinText === "string" || !command.kubeconfigPath) return null;
    const api = this.client(command.kubeconfigPath);
    return api ? { api, kubeconfigPath: command.kubeconfigPath } : null;
  }

  // `kubectl api-resources --verbs=list -o wide` from aggregated discovery.
  private async apiResources(api: ClusterApi, kubeconfigPath: string, command: KubectlCommand, signal?: AbortSignal): Promise<CommandResult | null> {
    const started = Date.now();
    const read = async (path: string) => {
      const preview = `GET ${api.url(path).href}`;
      return parseJsonOutput(await api.get(path, { timeoutSeconds: command.timeoutSeconds, maxBytes: command.maxOutputBytes, signal, preview, accept: AGGREGATED_DISCOVERY_ACCEPT }), preview);
    };
    let table: string | null;
    try {
      const [core, groups] = await Promise.all([read("/api"), read("/apis")]);
      table = apiResourcesTable(core, groups);
    } catch (error) {
      if (error instanceof DirectApiUnavailable) {
        this.giveUp(api, kubeconfigPath, error.message);
        return null;
      }
      throw error;
    }
    // A server without aggregated discovery answered in the legacy form.
    if (!table) return null;
    this.log(`node api discovery ${api.url("/apis").origin} ok ms=${Date.now() - started}`);
    return { ok: true, stdout: table, stderr: "", commandPreview: `GET ${api.url("/apis").href}`, returnCode: 0 };
  }

  // The command's result, or null when kubectl has to run it.
  async run(command: KubectlCommand, signal?: AbortSignal): Promise<CommandResult | null> {
    if (isApiResourcesCommand(command.args)) {
      const target = this.usable(command);
      return target ? this.apiResources(target.api, target.kubeconfigPath, command, signal) : null;
    }
    const apiPath = rawGetPath(command.args);
    if (!apiPath) return null;
    const target = this.usable(command);
    if (!target) return null;
    const answer = await this.request(target.api, target.kubeconfigPath, apiPath, command, signal);
    return answer ? { ok: true, stdout: answer.stdout, stderr: "", commandPreview: answer.preview, returnCode: 0 } : null;
  }

  private async endpointFor(api: ClusterApi, kubeconfigPath: string, request: GetJsonRequest, signal?: AbortSignal): Promise<ResolvedEndpoint | null> {
    const builtIn = builtInEndpoint(request.resource);
    if (builtIn) return builtIn;
    const read = async (path: string) => {
      const preview = `GET ${api.url(path).href}`;
      return parseJsonOutput(await api.get(path, { timeoutSeconds: DISCOVERY_TIMEOUT_SECONDS, maxBytes: DISCOVERY_MAX_OUTPUT_BYTES, signal, preview }), preview);
    };
    try {
      return await resolveEndpointWith(read, `kubeconfig:${kubeconfigPath}`, request.resource);
    } catch (error) {
      if (error instanceof DirectApiUnavailable) this.giveUp(api, kubeconfigPath, error.message);
      else if (signal?.aborted) throw error;
      // A group that cannot be read is kubectl's to explain.
      return null;
    }
  }

  // The parsed JSON of a raw GET or a `get ... -o json`, or null when kubectl
  // has to run it.
  async runJson(command: KubectlCommand, signal?: AbortSignal): Promise<Record<string, unknown> | null> {
    const rawPath = rawGetPath(command.args);
    const getRequest = rawPath ? null : parseGetJson(command.args);
    if (!rawPath && !getRequest) return null;
    const target = this.usable(command);
    if (!target) return null;
    const { api, kubeconfigPath } = target;

    if (rawPath) {
      const answer = await this.request(api, kubeconfigPath, rawPath, command, signal);
      return answer ? parseJsonOutput(answer.stdout, answer.preview) : null;
    }

    const request = getRequest as GetJsonRequest;
    const endpoint = await this.endpointFor(api, kubeconfigPath, request, signal);
    const apiPath = endpoint ? getJsonPath(request, endpoint) : null;
    if (!apiPath) return null;
    let answer: { stdout: string; preview: string } | null;
    try {
      answer = await this.request(api, kubeconfigPath, apiPath, command, signal);
    } catch (error) {
      // A version this server does not serve: kubectl finds the one it does.
      if (!isMissingPath(error)) throw error;
      forgetCustomListEndpoint(`kubeconfig:${kubeconfigPath}`, request.resource);
      return null;
    }
    if (!answer) return null;
    const value = parseJsonOutput(answer.stdout, answer.preview);
    // A list read raw leaves kind and apiVersion off its items, where
    // `kubectl get -o json` fills them in.
    return request.name ? value : withItemTypes(value);
  }

  // A watch of `resource` in `namespace` ("all", "_cluster" or one namespace)
  // kept over the cluster's connection, already listed; null when kubectl has
  // to watch it.
  async informerFor(command: KubectlCommand, resource: string, namespace: string, callbacks: InformerCallbacks): Promise<ApiInformer | null> {
    const target = this.usable(command);
    if (!target) return null;
    const { api, kubeconfigPath } = target;
    const request: GetJsonRequest = {
      resource,
      name: null,
      namespace: namespace === "all" || namespace === "_cluster" ? null : namespace,
      allNamespaces: namespace === "all",
      fieldSelector: null,
      labelSelector: null,
    };
    const endpoint = await this.endpointFor(api, kubeconfigPath, request);
    const listPath = endpoint ? getJsonPath(request, endpoint) : null;
    if (!listPath) return null;
    const informer = new ApiInformer(api, listPath, callbacks, this.log);
    try {
      await informer.start();
    } catch (error) {
      if (error instanceof DirectApiUnavailable) {
        this.giveUp(api, kubeconfigPath, error.message);
        return null;
      }
      // A version the server does not serve: kubectl finds the one it does.
      if (isMissingPath(error)) return null;
      throw error;
    }
    return informer;
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
