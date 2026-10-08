// What KubeDeck needs to talk to a cluster's API server itself, read from the
// cluster's kubeconfig: the server, how to trust it and who to be.
//
// A KubeDeck cluster is one kubeconfig file, used through its current context
// (`clusterCommand` hands kubectl nothing but `--kubeconfig`). Whatever this
// does not understand makes the profile null, and the caller goes through
// kubectl exactly as before: the boundary is "kubectl's answer or ours, never a
// different one".

import fs from "node:fs";
import path from "node:path";
import { parseDocument } from "yaml";
import { MAX_KUBECONFIG_BYTES } from "../config/kubeconfigName";
import { isRecord } from "../validation";

export interface ExecEnvVar {
  name: string;
  value: string;
}

export interface ExecConfig {
  apiVersion: string;
  command: string;
  args: string[];
  env: ExecEnvVar[];
  provideClusterInfo: boolean;
  // Relative commands are resolved the way kubectl does: against the
  // kubeconfig's own directory when they name a path, through PATH otherwise.
  kubeconfigDir: string;
}

// `spec.cluster` of an ExecCredential when the plugin asks for it.
export interface ExecClusterInfo {
  server: string;
  "tls-server-name"?: string;
  "insecure-skip-tls-verify"?: boolean;
  "certificate-authority-data"?: string;
  "proxy-url"?: string;
}

export interface ConnectionProfile {
  // Changes whenever anything the profile was read from changes.
  stamp: string;
  server: URL;
  ca: string | null;
  insecure: boolean;
  serverName: string | null;
  proxyUrl: string | null;
  cert: string | null;
  key: string | null;
  token: string | null;
  tokenFile: string | null;
  exec: ExecConfig | null;
  execClusterInfo: ExecClusterInfo;
}

export type ProfileResult = { profile: ConnectionProfile } | { profile: null; reason: string };

interface CacheEntry {
  stamp: string;
  files: string[];
  result: ProfileResult;
}

const cache = new Map<string, CacheEntry>();

function fileStamp(pathname: string): string {
  try {
    const stat = fs.statSync(pathname);
    return `${stat.mtimeMs}:${stat.size}`;
  } catch {
    return "missing";
  }
}

function stampOf(files: string[]): string {
  return files.map((file) => `${file}=${fileStamp(file)}`).join("|");
}

function named(value: unknown, name: string): Record<string, unknown> | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter(isRecord).find((entry) => entry.name === name);
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

class Unsupported extends Error {}

function decodeData(value: unknown, field: string): string {
  const text = str(value).trim();
  if (!text) return "";
  const decoded = Buffer.from(text, "base64").toString("utf8");
  if (!decoded.trim()) throw new Unsupported(`${field} does not decode`);
  return decoded;
}

function resolveFile(kubeconfigDir: string, value: string): string {
  return path.isAbsolute(value) ? value : path.resolve(kubeconfigDir, value);
}

// `-data` wins over the file, as in client-go.
function readMaterial(data: unknown, file: unknown, field: string, kubeconfigDir: string, files: string[]): string | null {
  const inline = decodeData(data, `${field}-data`);
  if (inline) return inline;
  const name = str(file).trim();
  if (!name) return null;
  const resolved = resolveFile(kubeconfigDir, name);
  files.push(resolved);
  try {
    return fs.readFileSync(resolved, "utf8");
  } catch {
    throw new Unsupported(`${field} file cannot be read`);
  }
}

function readExec(value: Record<string, unknown>, kubeconfigDir: string): ExecConfig {
  const command = str(value.command).trim();
  if (!command) throw new Unsupported("exec without a command");
  const apiVersion = str(value.apiVersion).trim();
  if (apiVersion !== "client.authentication.k8s.io/v1" && apiVersion !== "client.authentication.k8s.io/v1beta1") {
    throw new Unsupported(`exec apiVersion ${apiVersion || "(none)"}`);
  }
  // kubectl started by KubeDeck has no terminal either, so a plugin that must
  // have one fails there too; it keeps failing there, with kubectl's message.
  if (str(value.interactiveMode) === "Always") throw new Unsupported("exec plugin needs a terminal");
  const args = Array.isArray(value.args) ? value.args.map((item) => String(item)) : [];
  const env = Array.isArray(value.env) ? value.env.filter(isRecord).map((item) => ({ name: str(item.name), value: str(item.value) })) : [];
  return { apiVersion, command, args, env, provideClusterInfo: value.provideClusterInfo === true, kubeconfigDir };
}

function buildProfile(kubeconfigPath: string, files: string[]): ConnectionProfile {
  const stat = fs.statSync(kubeconfigPath);
  if (stat.size > MAX_KUBECONFIG_BYTES) throw new Unsupported("kubeconfig is too large");
  const parsed: unknown = parseDocument(fs.readFileSync(kubeconfigPath, "utf8")).toJS();
  if (!isRecord(parsed)) throw new Unsupported("kubeconfig does not parse");
  const kubeconfigDir = path.dirname(kubeconfigPath);

  const contextName = str(parsed["current-context"]);
  if (!contextName) throw new Unsupported("no current context");
  const context = named(parsed.contexts, contextName)?.context;
  if (!isRecord(context)) throw new Unsupported("current context is not defined");
  const clusterEntry = named(parsed.clusters, str(context.cluster))?.cluster;
  if (!isRecord(clusterEntry)) throw new Unsupported("context cluster is not defined");
  // A context without a user is anonymous access, which kubectl allows.
  const userName = str(context.user);
  const userEntry = userName ? named(parsed.users, userName)?.user : {};
  if (!isRecord(userEntry)) throw new Unsupported("context user is not defined");

  const rawServer = str(clusterEntry.server).trim();
  if (!rawServer) throw new Unsupported("cluster has no server");
  let server: URL;
  try {
    server = new URL(rawServer);
  } catch {
    throw new Unsupported("server is not a URL");
  }
  if (server.protocol !== "https:" && server.protocol !== "http:") throw new Unsupported(`server scheme ${server.protocol}`);

  for (const field of ["auth-provider", "username", "password", "as", "as-uid", "as-groups", "as-user-extra"]) {
    if (userEntry[field] !== undefined && userEntry[field] !== null && userEntry[field] !== "") throw new Unsupported(`user ${field}`);
  }

  const proxyUrl = str(clusterEntry["proxy-url"]).trim() || null;
  if (proxyUrl && !/^https?:\/\//i.test(proxyUrl)) throw new Unsupported("proxy-url is not an HTTP proxy");

  const ca = readMaterial(clusterEntry["certificate-authority-data"], clusterEntry["certificate-authority"], "certificate-authority", kubeconfigDir, files);
  const cert = readMaterial(userEntry["client-certificate-data"], userEntry["client-certificate"], "client-certificate", kubeconfigDir, files);
  const key = readMaterial(userEntry["client-key-data"], userEntry["client-key"], "client-key", kubeconfigDir, files);
  if (Boolean(cert) !== Boolean(key)) throw new Unsupported("client certificate without its key");

  const tokenFileName = str(userEntry.tokenFile).trim();
  const tokenFile = tokenFileName ? resolveFile(kubeconfigDir, tokenFileName) : null;
  const token = str(userEntry.token).trim() || null;
  const exec = isRecord(userEntry.exec) ? readExec(userEntry.exec, kubeconfigDir) : null;

  const insecure = clusterEntry["insecure-skip-tls-verify"] === true;
  const serverName = str(clusterEntry["tls-server-name"]).trim() || null;
  const execClusterInfo: ExecClusterInfo = { server: rawServer };
  if (serverName) execClusterInfo["tls-server-name"] = serverName;
  if (insecure) execClusterInfo["insecure-skip-tls-verify"] = true;
  if (ca) execClusterInfo["certificate-authority-data"] = Buffer.from(ca, "utf8").toString("base64");
  if (proxyUrl) execClusterInfo["proxy-url"] = proxyUrl;

  return { stamp: "", server, ca, insecure, serverName, proxyUrl, cert, key, token, tokenFile, exec, execClusterInfo };
}

export function connectionProfile(kubeconfigPath: string | null | undefined): ProfileResult {
  if (!kubeconfigPath) return { profile: null, reason: "no kubeconfig" };
  const cached = cache.get(kubeconfigPath);
  if (cached && stampOf(cached.files) === cached.stamp) return cached.result;

  const files = [kubeconfigPath];
  let result: ProfileResult;
  try {
    const profile = buildProfile(kubeconfigPath, files);
    result = { profile };
  } catch (error) {
    result = { profile: null, reason: error instanceof Unsupported ? error.message : "kubeconfig cannot be read" };
  }
  const stamp = stampOf(files);
  if (result.profile) result.profile.stamp = stamp;
  cache.set(kubeconfigPath, { stamp, files, result });
  return result;
}

export function clearConnectionProfiles(): void {
  cache.clear();
}
