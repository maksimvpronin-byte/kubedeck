import type { IncomingMessage, ServerResponse } from "node:http";

import type { ResourceSnapshotCache } from "../cache/resourceSnapshotCache";
import { ClusterNotFoundError, type ConfigStore } from "../config/configStore";
import { writeError } from "../errors";
import { writeJson } from "../http";
import { clusterCommand } from "../kubectl/clusterCommand";
import { KubectlError, writeKubectlError } from "../kubectl/errors";
import type { KubectlRunner } from "../kubectl/runner";
import { normalizeResourceItems } from "../resources/normalizers";
import {
  applyNamespaceMetrics,
  applyPodMetrics,
} from "../resources/metrics";
import {
  parseBooleanQuery,
  RequestValidationError,
  validateIdentifier,
} from "../validation";

const RESOURCE_TIMEOUT_SECONDS = 45;
const RESOURCE_MAX_OUTPUT_BYTES = 64 * 1024 * 1024;
const READINESS_TIMEOUT_SECONDS = 5;
const READINESS_MAX_OUTPUT_BYTES = 1024 * 1024;

interface ResourceListTarget {
  clusterId: string;
  resource: string;
  namespace: string;
  useCache: boolean;
  forceRefresh: boolean;
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

function asItems(value: unknown): unknown[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const items = (value as Record<string, unknown>).items;
  return Array.isArray(items) ? items : [];
}

function clusterScopedWithoutNamespaceArgument(resource: string): boolean {
  return new Set([
    "namespaces",
    "namespace",
    "ns",
    "nodes",
    "node",
    "customresourcedefinitions",
    "customresourcedefinition",
    "crd",
    "crds",
    "customresourcedefinitions.apiextensions.k8s.io",
    "customresourcedefinition.apiextensions.k8s.io",
    "clusterroles",
    "clusterrole",
    "clusterrolebindings",
    "clusterrolebinding",
    "persistentvolumes",
    "persistentvolume",
    "storageclasses",
    "storageclass",
  ]).has(resource);
}

export function matchResourceListRoute(
  method: string | undefined,
  pathname: string,
  requestUrl: string | undefined,
): ResourceListTarget | null {
  if (method !== "GET") return null;

  const match = pathname.match(
    /^\/clusters\/([^/]+)\/resources\/([^/]+)$/,
  );
  if (!match) return null;

  const url = new URL(requestUrl ?? pathname, "http://127.0.0.1");
  const rawNamespace = url.searchParams.get("namespace")?.trim() || "all";
  const namespace =
    rawNamespace === "all" || rawNamespace === "_cluster"
      ? rawNamespace
      : validateIdentifier(rawNamespace, "namespace");

  return {
    clusterId: validateIdentifier(
      decodePathPart(match[1], "cluster_id"),
      "cluster_id",
      128,
    ),
    resource: validateIdentifier(
      decodePathPart(match[2], "resource"),
      "resource",
      128,
    ).toLowerCase(),
    namespace,
    useCache: parseBooleanQuery(
      url.searchParams.get("useCache"),
      "useCache",
      false,
    ),
    forceRefresh: parseBooleanQuery(
      url.searchParams.get("forceRefresh"),
      "forceRefresh",
      false,
    ),
  };
}

function resourceArgs(target: ResourceListTarget): string[] {
  const args = ["get", target.resource];

  if (!clusterScopedWithoutNamespaceArgument(target.resource)) {
    if (target.namespace === "all") args.push("-A");
    else if (target.namespace !== "_cluster") {
      args.push("-n", target.namespace);
    }
  }

  args.push("-o", "json");
  return args;
}

async function verifyClusterReadiness(
  configStore: ConfigStore,
  runner: KubectlRunner,
  clusterId: string,
): Promise<void> {
  await runner.run(
    clusterCommand(
      configStore,
      clusterId,
      ["get", "--raw=/readyz"],
      READINESS_TIMEOUT_SECONDS,
      READINESS_MAX_OUTPUT_BYTES,
    ),
  );
}

async function loadResources(
  response: ServerResponse,
  target: ResourceListTarget,
  configStore: ConfigStore,
  runner: KubectlRunner,
  cache: ResourceSnapshotCache,
): Promise<void> {
  if (target.useCache && !target.forceRefresh) {
    const cached = cache.get(
      target.clusterId,
      target.resource,
      target.namespace,
    );

    if (cached) {
      try {
        await verifyClusterReadiness(
          configStore,
          runner,
          target.clusterId,
        );
      } catch (error) {
        cache.clear(target.clusterId, "cluster.unavailable");
        throw error;
      }

      writeJson(response, cached);
      return;
    }
  }

  try {
    const data = await runner.runJson(
      clusterCommand(
        configStore,
        target.clusterId,
        resourceArgs(target),
        RESOURCE_TIMEOUT_SECONDS,
        RESOURCE_MAX_OUTPUT_BYTES,
      ),
    );

    const rawItems = asItems(data);
    const rows = normalizeResourceItems(target.resource, rawItems);

    if (target.resource === "pods" || target.resource === "pod") {
      await applyPodMetrics(
        configStore,
        runner,
        target.clusterId,
        target.namespace,
        rows,
      );
    }

    if (
      target.resource === "namespaces" ||
      target.resource === "namespace" ||
      target.resource === "ns"
    ) {
      await applyNamespaceMetrics(
        configStore,
        runner,
        target.clusterId,
        rows,
      );
    }

    const result = cache.set(
      target.clusterId,
      target.resource,
      target.namespace,
      {
        items: rows,
        rawCount: rawItems.length,
        kind: "ResourceList",
      },
    );

    writeJson(response, result);
  } catch (error) {
    if (error instanceof KubectlError) {
      cache.clear(target.clusterId, "kubectl.failure");
    }
    throw error;
  }
}

function handleCacheStatus(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  cache: ResourceSnapshotCache,
  clearDiscoveryCache: (clusterId?: string) => void,
): boolean {
  if (request.method === "GET" && pathname === "/resource-cache/status") {
    writeJson(response, cache.status());
    return true;
  }

  if (request.method === "POST" && pathname === "/resource-cache/clear") {
    const url = new URL(request.url ?? pathname, "http://127.0.0.1");
    const rawClusterId = url.searchParams.get("cluster_id")?.trim();
    const clusterId = rawClusterId
      ? validateIdentifier(rawClusterId, "cluster_id", 128)
      : undefined;
    const cleared = cache.clear(
      clusterId,
      clusterId ? "manual.clear_cluster" : "manual.clear_all",
    );
    clearDiscoveryCache(clusterId);
    writeJson(response, { cleared });
    return true;
  }

  return false;
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

  log(
    `gateway resource list failed: ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
  writeError(
    response,
    500,
    "RESOURCE_LIST_FAILED",
    "Unable to load Kubernetes resources",
  );
}

export function handleResourceListRequest(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  configStore: ConfigStore,
  runner: KubectlRunner,
  cache: ResourceSnapshotCache,
  clearDiscoveryCache: (clusterId?: string) => void,
  log: (message: string) => void,
): boolean {
  try {
    if (
      handleCacheStatus(
        request,
        response,
        pathname,
        cache,
        clearDiscoveryCache,
      )
    ) {
      return true;
    }

    const target = matchResourceListRoute(
      request.method,
      pathname,
      request.url,
    );
    if (!target) return false;

    void loadResources(
      response,
      target,
      configStore,
      runner,
      cache,
    ).catch((error) => writeRouteError(response, error, log));

    return true;
  } catch (error) {
    writeRouteError(response, error, log);
    return true;
  }
}
