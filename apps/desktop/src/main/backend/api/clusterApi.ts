// One cluster's API server, spoken to directly over a kept-alive connection.
//
// kubectl is a process per request: start, read the kubeconfig, run the auth
// plugin, shake hands with the server, answer, exit. Here the handshake and the
// credentials outlive the request, which is most of what a table refresh used
// to wait for.

import fs from "node:fs";
import http, { type IncomingMessage } from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import zlib from "node:zlib";
import { KubectlError } from "../kubectl/errors";
import { cancelledError, isTransportSetupError, networkError, statusError, timeoutError, tooLargeError } from "./apiErrors";
import { type ExecCredential, type ExecCredentialCache, ExecPluginError } from "./execCredentials";
import type { ConnectionProfile } from "./kubeconfigProfile";
import { proxyFor } from "./proxyRoute";
import { TunnelingHttpAgent, TunnelingHttpsAgent } from "./proxyTunnel";

const MAX_SOCKETS = 16;
const MAX_ERROR_BODY_BYTES = 256 * 1024;

// kubectl could still succeed where this failed: a TLS or proxy disagreement
// between Node and Go, an auth plugin that would not run from here. The caller
// goes through kubectl instead of reporting it.
export class DirectApiUnavailable extends Error {}

export interface GetOptions {
  timeoutSeconds: number;
  maxBytes: number;
  signal?: AbortSignal;
  preview: string;
}

interface Credentials {
  token: string | null;
  cert: string | null;
  key: string | null;
  exec: ExecCredential | null;
}

let systemRoots: string[] | null = null;

// kubectl on Windows and macOS trusts the operating system's store when the
// kubeconfig names no CA; Node trusts only its bundled list unless told.
function defaultRoots(): string[] {
  if (systemRoots) return systemRoots;
  const roots = new Set<string>(tls.rootCertificates);
  try {
    for (const cert of tls.getCACertificates("system")) roots.add(cert);
  } catch {
    // An older runtime without access to the system store keeps the bundled list.
  }
  systemRoots = [...roots];
  return systemRoots;
}

// kubectl's `--request-timeout` for a command given `seconds`.
export function requestTimeoutSeconds(seconds: number): number {
  return Math.max(5, Math.min(seconds, Math.max(5, seconds - 5)));
}

export class ClusterApi {
  private readonly agents = new Map<string, http.Agent>();
  private readonly proxy: string | null;

  constructor(
    readonly profile: ConnectionProfile,
    private readonly environment: NodeJS.ProcessEnv,
    private readonly execCredentials: ExecCredentialCache,
  ) {
    this.proxy = proxyFor(profile.server, profile.proxyUrl, environment);
    if (this.proxy && !/^https?:\/\//i.test(this.proxy)) throw new DirectApiUnavailable(`proxy ${this.proxy.split(":")[0]} is not supported`);
  }

  url(path: string): URL {
    const base = this.profile.server;
    const prefix = base.pathname.replace(/\/+$/, "");
    return new URL(`${base.protocol}//${base.host}${prefix}${path}`);
  }

  private agentFor(cert: string | null, key: string | null): http.Agent {
    const id = cert ?? "";
    const existing = this.agents.get(id);
    if (existing) return existing;
    const proxy = this.proxy ? new URL(this.proxy) : null;
    let agent: http.Agent;
    try {
      if (this.profile.server.protocol === "http:") {
        const options: http.AgentOptions = { keepAlive: true, maxSockets: MAX_SOCKETS };
        agent = proxy ? new TunnelingHttpAgent(proxy, options) : new http.Agent(options);
      } else {
        const serverName = this.profile.serverName ?? (net.isIP(this.profile.server.hostname) ? undefined : this.profile.server.hostname);
        const ca = this.profile.ca ?? defaultRoots();
        // Bad PEM is found here, once, rather than as a failure of every request.
        tls.createSecureContext({ ca, ...(cert && key ? { cert, key } : {}) });
        const options: https.AgentOptions = {
          keepAlive: true,
          maxSockets: MAX_SOCKETS,
          ca,
          rejectUnauthorized: !this.profile.insecure,
          ...(serverName ? { servername: serverName } : {}),
          ...(cert && key ? { cert, key } : {}),
        };
        agent = proxy ? new TunnelingHttpsAgent(proxy, options) : new https.Agent(options);
      }
    } catch (error) {
      throw new DirectApiUnavailable(`connection settings are not usable: ${error instanceof Error ? error.message : String(error)}`);
    }
    // A client certificate that rotated leaves its old agent behind; only the
    // current ones are kept.
    if (this.agents.size >= 4) this.close();
    this.agents.set(id, agent);
    return agent;
  }

  private async credentials(): Promise<Credentials> {
    const { profile } = this;
    let token = profile.token;
    if (!token && profile.tokenFile) {
      try {
        token = fs.readFileSync(profile.tokenFile, "utf8").trim() || null;
      } catch {
        throw new DirectApiUnavailable("token file cannot be read");
      }
    }
    if (token || !profile.exec) return { token, cert: profile.cert, key: profile.key, exec: null };
    let exec: ExecCredential;
    try {
      exec = await this.execCredentials.get(profile.exec, profile.execClusterInfo, this.environment);
    } catch (error) {
      if (error instanceof ExecPluginError) throw new DirectApiUnavailable(error.message);
      throw error;
    }
    return { token: exec.token, cert: exec.cert ?? profile.cert, key: exec.key ?? profile.key, exec };
  }

  // Opens a GET and resolves with the response once its headers are in.
  private async open(path: string, options: { signal?: AbortSignal; preview: string; gzip: boolean }): Promise<{ response: IncomingMessage; credentials: Credentials; request: http.ClientRequest }> {
    if (options.signal?.aborted) throw cancelledError(options.preview);
    const credentials = await this.credentials();
    const agent = this.agentFor(credentials.cert, credentials.key);
    const target = this.url(path);
    const headers: http.OutgoingHttpHeaders = { Accept: "application/json", "User-Agent": "KubeDeck" };
    if (options.gzip) headers["Accept-Encoding"] = "gzip";
    if (credentials.token) headers.Authorization = `Bearer ${credentials.token}`;
    const transport = target.protocol === "http:" ? http : https;

    return new Promise((resolve, reject) => {
      let request: http.ClientRequest;
      try {
        request = transport.request(target, { method: "GET", agent, headers });
      } catch (error) {
        reject(new DirectApiUnavailable(error instanceof Error ? error.message : String(error)));
        return;
      }
      const onAbort = () => {
        request.destroy();
        reject(cancelledError(options.preview));
      };
      options.signal?.addEventListener("abort", onAbort, { once: true });
      request.once("response", (response) => {
        options.signal?.removeEventListener("abort", onAbort);
        resolve({ response, credentials, request });
      });
      request.once("error", (error) => {
        options.signal?.removeEventListener("abort", onAbort);
        if (options.signal?.aborted) reject(cancelledError(options.preview));
        else if (isTransportSetupError(error)) reject(new DirectApiUnavailable(`${(error as NodeJS.ErrnoException).code}: ${error.message}`));
        else reject(networkError(error, this.profile.server, options.preview));
      });
      request.end();
    });
  }

  private readBody(response: IncomingMessage, maxBytes: number, preview: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const source: NodeJS.ReadableStream = response.headers["content-encoding"] === "gzip" ? response.pipe(zlib.createGunzip()) : response;
      const chunks: Buffer[] = [];
      let total = 0;
      let done = false;
      const fail = (error: Error) => {
        if (done) return;
        done = true;
        response.destroy();
        reject(error);
      };
      source.on("data", (chunk: Buffer) => {
        total += chunk.length;
        if (maxBytes > 0 && total > maxBytes) fail(tooLargeError(total, maxBytes, preview));
        else chunks.push(chunk);
      });
      source.on("end", () => {
        if (done) return;
        done = true;
        resolve(Buffer.concat(chunks).toString("utf8"));
      });
      source.on("error", (error: Error) => fail(networkError(error, this.profile.server, preview)));
      response.on("aborted", () => fail(networkError(Object.assign(new Error("connection reset"), { code: "ECONNRESET" }), this.profile.server, preview)));
    });
  }

  // The body of a successful GET, or the KubectlError kubectl would have failed with.
  async get(path: string, options: GetOptions, retried = false): Promise<string> {
    const timeoutSeconds = options.timeoutSeconds > 0 ? requestTimeoutSeconds(options.timeoutSeconds) : 0;
    const controller = new AbortController();
    let timedOut = false;
    const timer = timeoutSeconds
      ? setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, timeoutSeconds * 1000)
      : undefined;
    const onAbort = () => controller.abort();
    options.signal?.addEventListener("abort", onAbort, { once: true });
    const translate = (error: unknown): unknown =>
      timedOut && error instanceof KubectlError && error.info.code === "KUBECTL_CANCELLED" ? timeoutError(this.profile.server, path, timeoutSeconds, options.preview) : error;
    try {
      const { response, credentials } = await this.open(path, { signal: controller.signal, preview: options.preview, gzip: true });
      const status = response.statusCode ?? 0;
      if (status >= 200 && status < 300) {
        const readAbort = () => response.destroy();
        controller.signal.addEventListener("abort", readAbort, { once: true });
        try {
          return await this.readBody(response, options.maxBytes, options.preview);
        } catch (error) {
          if (controller.signal.aborted) throw cancelledError(options.preview);
          throw error;
        } finally {
          controller.signal.removeEventListener("abort", readAbort);
        }
      }
      const body = await this.readBody(response, MAX_ERROR_BODY_BYTES, options.preview).catch(() => "");
      if (status === 401 && credentials.exec && !retried && this.profile.exec) {
        this.execCredentials.invalidate(this.profile.exec, this.profile.execClusterInfo, credentials.exec);
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", onAbort);
        return this.get(path, options, true);
      }
      throw statusError(status, body, options.preview);
    } catch (error) {
      throw translate(error);
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
    }
  }

  // A long-lived GET (a watch), uncompressed so each event arrives as it is
  // sent. Resolves once the server accepted it; a refusal comes back as the
  // same error `get` would give.
  async stream(path: string, options: { signal: AbortSignal; preview: string }, retried = false): Promise<IncomingMessage> {
    const { response, credentials } = await this.open(path, { ...options, gzip: false });
    const status = response.statusCode ?? 0;
    if (status >= 200 && status < 300) {
      if (options.signal.aborted) response.destroy();
      else options.signal.addEventListener("abort", () => response.destroy(), { once: true });
      return response;
    }
    const body = await this.readBody(response, MAX_ERROR_BODY_BYTES, options.preview).catch(() => "");
    if (status === 401 && credentials.exec && !retried && this.profile.exec) {
      this.execCredentials.invalidate(this.profile.exec, this.profile.execClusterInfo, credentials.exec);
      return this.stream(path, options, true);
    }
    throw statusError(status, body, options.preview);
  }

  close(): void {
    for (const agent of this.agents.values()) agent.destroy();
    this.agents.clear();
  }
}
