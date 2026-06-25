import type { IncomingMessage, ServerResponse } from "node:http";
import { ClusterNotFoundError, type ConfigStore } from "../config/configStore";
import { writeError } from "../errors";
import { writeJson } from "../http";
import { clusterCommand } from "../kubectl/clusterCommand";
import { KubectlError, writeKubectlError } from "../kubectl/errors";
import type { KubectlRunner } from "../kubectl/runner";
import {
  normalizeTailLines,
  parseBooleanQuery,
  RequestValidationError,
  validateIdentifier,
} from "../validation";

const DEPLOYMENT_JSON_MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const POD_LIST_MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
const LOGS_MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
const LOGS_FULL_MAX_OUTPUT_BYTES = 32 * 1024 * 1024;
const LOG_LOAD_CONCURRENCY = 4;

type JsonObject = Record<string, unknown>;
type DeploymentLogOperation = "log-targets" | "logs";

export interface DeploymentLogTarget {
  clusterId: string;
  namespace: string;
  name: string;
  operation: DeploymentLogOperation;
}

export interface DeploymentLogPod {
  name: string;
  phase: string;
  containers: string[];
  createdAt: string;
}

export interface DeploymentLogOptions {
  allLogs: boolean;
  previous: boolean;
  timestamps: boolean;
  prefix: boolean;
  tail: number;
  container: string;
  pod: string;
}

export interface DeploymentPodLogInvocation {
  args: string[];
  timeoutSeconds: number;
  maxOutputBytes: number;
  header: string;
}

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : {};
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asObjectArray(value: unknown): JsonObject[] {
  return Array.isArray(value)
    ? value.filter((item): item is JsonObject =>
      Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
}

function decodePathPart(value: string, field: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new RequestValidationError(
      400,
      "INVALID_IDENTIFIER",
      `${field} is not valid URL encoding`,
    );
  }
}

export function matchDeploymentLogsPath(pathname: string): DeploymentLogTarget | null {
  const match = pathname.match(
    /^\/clusters\/([^/]+)\/deployments\/([^/]+)\/([^/]+)\/(log-targets|logs)$/,
  );
  if (!match) return null;

  return {
    clusterId: decodePathPart(match[1], "cluster_id"),
    namespace: validateIdentifier(
      decodePathPart(match[2], "namespace"),
      "namespace",
    ),
    name: validateIdentifier(decodePathPart(match[3], "name"), "name"),
    operation: match[4] as DeploymentLogOperation,
  };
}

export function selectorMatches(
  labelsValue: unknown,
  selectorValue: unknown,
): boolean {
  const labels = asObject(labelsValue);
  const selector = asObject(selectorValue);
  const matchLabels = asObject(selector.matchLabels);

  for (const [key, expected] of Object.entries(matchLabels)) {
    if (String(labels[key] ?? "") !== String(expected ?? "")) return false;
  }

  for (const expression of asObjectArray(selector.matchExpressions)) {
    const key = asString(expression.key);
    const operator = asString(expression.operator);
    const values = new Set(
      Array.isArray(expression.values)
        ? expression.values.map((value) => String(value))
        : [],
    );
    const hasKey = Object.prototype.hasOwnProperty.call(labels, key);
    const actual = String(labels[key] ?? "");

    if (operator === "In" && (!hasKey || !values.has(actual))) return false;
    if (operator === "NotIn" && hasKey && values.has(actual)) return false;
    if (operator === "Exists" && !hasKey) return false;
    if (operator === "DoesNotExist" && hasKey) return false;
  }

  return true;
}

function deploymentSelector(deploymentValue: unknown): JsonObject {
  const deployment = asObject(deploymentValue);
  const spec = asObject(deployment.spec);
  const selector = asObject(spec.selector);

  if (Object.keys(selector).length === 0) {
    throw new RequestValidationError(
      400,
      "DEPLOYMENT_SELECTOR_MISSING",
      "Deployment selector is missing",
    );
  }

  return selector;
}

export function matchingDeploymentPods(
  deploymentValue: unknown,
  podListValue: unknown,
): DeploymentLogPod[] {
  const selector = deploymentSelector(deploymentValue);
  const podList = asObject(podListValue);
  const pods: DeploymentLogPod[] = [];

  for (const item of asObjectArray(podList.items)) {
    const metadata = asObject(item.metadata);
    if (!selectorMatches(metadata.labels, selector)) continue;

    const podSpec = asObject(item.spec);
    const status = asObject(item.status);
    const containers = asObjectArray(podSpec.containers)
      .map((container) => asString(container.name))
      .filter(Boolean);

    pods.push({
      name: asString(metadata.name),
      phase: asString(status.phase),
      containers,
      createdAt: asString(metadata.creationTimestamp),
    });
  }

  return pods.sort((left, right) => {
    const byCreatedAt = left.createdAt.localeCompare(right.createdAt);
    return byCreatedAt !== 0 ? byCreatedAt : left.name.localeCompare(right.name);
  });
}

export function parseDeploymentLogOptions(requestUrl: string): DeploymentLogOptions {
  const url = new URL(requestUrl, "http://127.0.0.1");
  const allLogs = parseBooleanQuery(url.searchParams.get("all"), "all");
  const previous = parseBooleanQuery(url.searchParams.get("previous"), "previous");
  const timestamps = parseBooleanQuery(
    url.searchParams.get("timestamps"),
    "timestamps",
  );
  const prefix = parseBooleanQuery(url.searchParams.get("prefix"), "prefix", true);
  const containerValue = url.searchParams.get("container");
  const podValue = url.searchParams.get("pod");

  return {
    allLogs,
    previous,
    timestamps,
    prefix,
    tail: allLogs ? -1 : normalizeTailLines(url.searchParams.get("tail")),
    container: containerValue
      ? validateIdentifier(containerValue, "container", 253)
      : "",
    pod: podValue ? validateIdentifier(podValue, "pod", 253) : "",
  };
}

export function buildDeploymentPodLogInvocation(
  namespace: string,
  pod: DeploymentLogPod,
  options: DeploymentLogOptions,
): DeploymentPodLogInvocation {
  const args = ["--request-timeout=20s", "logs", pod.name, "-n", namespace];
  if (options.prefix) args.push("--prefix=true");
  args.push(options.allLogs ? "--tail=-1" : `--tail=${options.tail}`);

  if (options.container) {
    args.push("-c", options.container);
  } else if (pod.containers.length > 1) {
    args.push("--all-containers=true");
  }

  if (options.previous) args.push("--previous");
  if (options.timestamps) args.push("--timestamps");

  const headerContainer = options.container || (
    pod.containers.length > 1
      ? "all containers"
      : (pod.containers[0] || "default")
  );

  return {
    args,
    timeoutSeconds: options.allLogs ? 60 : 35,
    maxOutputBytes: options.allLogs
      ? LOGS_FULL_MAX_OUTPUT_BYTES
      : LOGS_MAX_OUTPUT_BYTES,
    header: `===== pod/${pod.name} · ${headerContainer} =====`,
  };
}

export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];

  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(concurrency, items.length));

  async function runWorker(): Promise<void> {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }

  await Promise.all(
    Array.from({ length: workerCount }, () => runWorker()),
  );
  return results;
}

async function loadDeploymentAndPods(
  target: DeploymentLogTarget,
  configStore: ConfigStore,
  runner: KubectlRunner,
): Promise<DeploymentLogPod[]> {
  const deployment = await runner.runJson(clusterCommand(
    configStore,
    target.clusterId,
    ["get", "deployment", target.name, "-n", target.namespace, "-o", "json"],
    30,
    DEPLOYMENT_JSON_MAX_OUTPUT_BYTES,
  ));

  deploymentSelector(deployment);

  const podList = await runner.runJson(clusterCommand(
    configStore,
    target.clusterId,
    ["get", "pods", "-n", target.namespace, "-o", "json"],
    30,
    POD_LIST_MAX_OUTPUT_BYTES,
  ));

  return matchingDeploymentPods(deployment, podList);
}

function writePlainText(response: ServerResponse, body: string): void {
  response.statusCode = 200;
  response.setHeader("Content-Type", "text/plain; charset=utf-8");
  response.setHeader("Content-Length", Buffer.byteLength(body));
  response.end(body);
}

function writeRouteError(
  response: ServerResponse,
  error: unknown,
  log: (message: string) => void,
): void {
  if (error instanceof RequestValidationError) {
    writeError(response, error.statusCode, error.code, error.message);
    return;
  }
  if (error instanceof ClusterNotFoundError) {
    writeError(response, 404, "CLUSTER_NOT_FOUND", error.message);
    return;
  }
  if (error instanceof KubectlError) {
    writeKubectlError(response, error);
    return;
  }

  log(`gateway deployment logs failed: ${error instanceof Error ? error.message : String(error)}`);
  writeError(
    response,
    500,
    "DEPLOYMENT_LOGS_FAILED",
    "Unable to load deployment logs",
  );
}

async function writeDeploymentLogTargets(
  response: ServerResponse,
  target: DeploymentLogTarget,
  configStore: ConfigStore,
  runner: KubectlRunner,
): Promise<void> {
  const pods = await loadDeploymentAndPods(target, configStore, runner);
  const containers = [...new Set(
    pods.flatMap((pod) => pod.containers),
  )].sort((left, right) => left.localeCompare(right));

  writeJson(response, {
    namespace: target.namespace,
    name: target.name,
    pods: pods.map((pod) => ({
      name: pod.name,
      phase: pod.phase,
      containers: pod.containers,
    })),
    containers,
  });
}

async function writeDeploymentLogs(
  request: IncomingMessage,
  response: ServerResponse,
  target: DeploymentLogTarget,
  configStore: ConfigStore,
  runner: KubectlRunner,
): Promise<void> {
  const options = parseDeploymentLogOptions(request.url ?? "/");
  let pods = await loadDeploymentAndPods(target, configStore, runner);

  if (options.pod) {
    pods = pods.filter((pod) => pod.name === options.pod);
  }

  if (pods.length === 0) {
    writePlainText(
      response,
      `No pods matched deployment/${target.name} in namespace ${target.namespace}.`,
    );
    return;
  }

  const blocks = await mapWithConcurrency(
    pods,
    LOG_LOAD_CONCURRENCY,
    async (pod): Promise<string> => {
      const invocation = buildDeploymentPodLogInvocation(
        target.namespace,
        pod,
        options,
      );

      try {
        const result = await runner.run(clusterCommand(
          configStore,
          target.clusterId,
          invocation.args,
          invocation.timeoutSeconds,
          invocation.maxOutputBytes,
        ));
        const output = result.stdout.trimEnd() || "<no log lines>";
        return `${invocation.header}\n${output}`;
      } catch (error) {
        if (error instanceof KubectlError) {
          return `${invocation.header}\n<failed to load logs: ${error.info.message}>`;
        }
        throw error;
      }
    },
  );

  writePlainText(response, `${blocks.join("\n").trimEnd()}\n`);
}

export function handleDeploymentLogsRequest(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  configStore: ConfigStore,
  runner: KubectlRunner,
  log: (message: string) => void,
): boolean {
  if (request.method !== "GET") return false;

  let target: DeploymentLogTarget | null;
  try {
    target = matchDeploymentLogsPath(pathname);
  } catch (error) {
    writeRouteError(response, error, log);
    return true;
  }

  if (!target) return false;

  const operation = target.operation === "log-targets"
    ? writeDeploymentLogTargets(
      response,
      target,
      configStore,
      runner,
    )
    : writeDeploymentLogs(
      request,
      response,
      target,
      configStore,
      runner,
    );

  void operation.catch((error) => writeRouteError(response, error, log));
  return true;
}
