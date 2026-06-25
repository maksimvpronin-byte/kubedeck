import type { IncomingMessage, ServerResponse } from "node:http";
import { ClusterNotFoundError, type ConfigStore } from "../config/configStore";
import { writeError } from "../errors";
import { writeJson } from "../http";
import { clusterCommand } from "../kubectl/clusterCommand";
import { KubectlError, writeKubectlError } from "../kubectl/errors";
import type { KubectlRunner } from "../kubectl/runner";
import {
  buildSearchResourceSpecs,
  compareSearchResults,
  deduplicateSearchResults,
  parseApiResources,
  rankRawItems,
  type ApiResourceDefinition,
  type SearchResourceSpec,
  type SearchResultRow,
} from "../search/searchEngine";
import { RequestValidationError, validateIdentifier } from "../validation";

const SEARCH_QUERY_MAX_CHARS = 128;
const SEARCH_TOTAL_TIMEOUT_SECONDS = 12;
const SEARCH_KUBECTL_TIMEOUT_SECONDS = 10;
const SEARCH_CONCURRENCY = 3;
const SEARCH_MAX_OUTPUT_BYTES = 12 * 1024 * 1024;
const SEARCH_MAX_CRD_INSTANCE_RESOURCES = 12;
const SEARCH_API_RESOURCES_MAX_OUTPUT_BYTES = 16 * 1024 * 1024;

interface SearchTarget {
  clusterId: string;
}

interface SearchOptions {
  query: string;
  namespaces: string[];
  limit: number;
  includeCrdInstances: boolean;
}

interface SearchSourceResult {
  spec: SearchResourceSpec;
  items: SearchResultRow[];
  rawCount: number;
  error: Record<string, unknown> | null;
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

function normalizeSearchQuery(value: string): string {
  const query = value.trim().split(/\s+/).filter(Boolean).join(" ");
  if (query.length < 2) {
    throw new RequestValidationError(
      400,
      "SEARCH_QUERY_TOO_SHORT",
      "Search query must contain at least 2 characters",
    );
  }
  if (query.length > SEARCH_QUERY_MAX_CHARS) {
    throw new RequestValidationError(
      400,
      "SEARCH_QUERY_TOO_LONG",
      `Search query must be at most ${SEARCH_QUERY_MAX_CHARS} characters`,
    );
  }
  return query;
}

function normalizeSearchNamespaces(value: string): string[] {
  const raw = (value || "all")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (raw.length === 0 || raw.includes("all")) return ["all"];
  if (raw.includes("_cluster")) return ["_cluster"];
  return raw.slice(0, 20).map((item) => validateIdentifier(item, "namespace"));
}

function parseLimit(value: string | null): number {
  if (value === null || value.trim() === "") return 200;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 500) {
    throw new RequestValidationError(
      400,
      "INVALID_SEARCH_LIMIT",
      "Search limit must be an integer between 1 and 500",
    );
  }
  return parsed;
}

function parseBoolean(value: string | null, fallback: boolean): boolean {
  if (value === null || value.trim() === "") return fallback;
  const normalized = value.trim().toLocaleLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "off"].includes(normalized)) return false;
  throw new RequestValidationError(
    400,
    "INVALID_BOOLEAN",
    "includeCrdInstances must be true or false",
  );
}

function requestOptions(request: IncomingMessage): SearchOptions {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  return {
    query: normalizeSearchQuery(url.searchParams.get("q") ?? ""),
    namespaces: normalizeSearchNamespaces(url.searchParams.get("namespace") ?? "all"),
    limit: parseLimit(url.searchParams.get("limit")),
    includeCrdInstances: parseBoolean(
      url.searchParams.get("includeCrdInstances"),
      true,
    ),
  };
}

export function matchSearchRoute(
  method: string | undefined,
  pathname: string,
): SearchTarget | null {
  if (method !== "GET") return null;
  const match = pathname.match(/^\/clusters\/([^/]+)\/search$/);
  if (!match) return null;
  return {
    clusterId: validateIdentifier(
      decodePathPart(match[1], "cluster_id"),
      "cluster_id",
      128,
    ),
  };
}

async function discoverResourceDefinitions(
  configStore: ConfigStore,
  runner: KubectlRunner,
  clusterId: string,
): Promise<ApiResourceDefinition[]> {
  const result = await runner.run(
    clusterCommand(
      configStore,
      clusterId,
      ["api-resources", "--verbs=list", "-o", "wide"],
      30,
      SEARCH_API_RESOURCES_MAX_OUTPUT_BYTES,
    ),
  );
  return parseApiResources(result.stdout);
}

function resourceArgs(spec: SearchResourceSpec, namespaceMode: string): string[] {
  const args = ["get", spec.resource];
  if (spec.scope === "namespaced") {
    if (namespaceMode === "all") args.push("-A");
    else if (namespaceMode && namespaceMode !== "_cluster") {
      args.push("-n", namespaceMode);
    }
  }
  args.push("-o", "json");
  return args;
}

async function searchSource(
  configStore: ConfigStore,
  runner: KubectlRunner,
  clusterId: string,
  spec: SearchResourceSpec,
  namespaces: string[],
  query: string,
  limitPerResource: number,
): Promise<SearchSourceResult> {
  const namespaceModes = spec.scope === "cluster" ? ["_cluster"] : namespaces;
  const collected: SearchResultRow[] = [];
  let rawCount = 0;
  try {
    for (const namespaceMode of namespaceModes) {
      const data = await runner.runJson(
        clusterCommand(
          configStore,
          clusterId,
          resourceArgs(spec, namespaceMode),
          SEARCH_KUBECTL_TIMEOUT_SECONDS,
          SEARCH_MAX_OUTPUT_BYTES,
        ),
      );
      const items = asItems(data);
      rawCount += items.length;
      collected.push(
        ...rankRawItems(
          spec,
          items,
          query,
          Math.max(0, limitPerResource - collected.length),
        ),
      );
      if (collected.length >= limitPerResource) break;
    }
    return {
      spec,
      items: collected.sort(compareSearchResults).slice(0, limitPerResource),
      rawCount,
      error: null,
    };
  } catch (error) {
    if (error instanceof KubectlError) {
      return {
        spec,
        items: [],
        rawCount: 0,
        error: {
          ...error.info,
          resource: spec.resource,
          namespace: namespaces.join(","),
        },
      };
    }
    return {
      spec,
      items: [],
      rawCount: 0,
      error: {
        code: "SEARCH_SOURCE_FAILED",
        message: error instanceof Error ? error.message : String(error),
        rawStderr: "",
        commandPreview: "",
        resource: spec.resource,
        namespace: namespaces.join(","),
      },
    };
  }
}

async function collectSearchSources(
  specs: SearchResourceSpec[],
  worker: (spec: SearchResourceSpec) => Promise<void>,
  timeoutSeconds: number,
  concurrency: number,
): Promise<boolean> {
  let index = 0;
  let completed = false;
  const workers = Array.from(
    { length: Math.min(Math.max(1, concurrency), Math.max(1, specs.length)) },
    async () => {
      while (true) {
        const current = index;
        index += 1;
        if (current >= specs.length) return;
        await worker(specs[current]);
      }
    },
  );
  const work = Promise.all(workers).then(() => {
    completed = true;
  });
  let timer: NodeJS.Timeout | undefined;
  await Promise.race([
    work,
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, timeoutSeconds * 1000);
      timer.unref?.();
    }),
  ]);
  if (timer) clearTimeout(timer);
  return completed;
}

export async function buildSearchResponse(
  configStore: ConfigStore,
  runner: KubectlRunner,
  clusterId: string,
  options: SearchOptions,
  log: (message: string) => void = () => {},
  now: () => Date = () => new Date(),
  runtime: { totalTimeoutSeconds?: number; concurrency?: number } = {},
): Promise<{
  items: SearchResultRow[];
  summary: Record<string, unknown>;
  errors: Array<Record<string, unknown>>;
}> {
  const config = configStore.load();
  configStore.getCluster(clusterId, config);

  let definitions: ApiResourceDefinition[] = [];
  try {
    definitions = await discoverResourceDefinitions(configStore, runner, clusterId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`global search: api-resources unavailable message=${message}`);
  }
  const specs = buildSearchResourceSpecs(
    options.query,
    options.includeCrdInstances,
    definitions,
    SEARCH_MAX_CRD_INSTANCE_RESOURCES,
  );
  const results: SearchResultRow[] = [];
  const errors: Array<Record<string, unknown>> = [];
  const sources: Record<string, number> = {};
  const limitPerResource = Math.max(10, Math.floor(options.limit / 3));
  let stopCollecting = false;

  const totalTimeoutSeconds = runtime.totalTimeoutSeconds ?? SEARCH_TOTAL_TIMEOUT_SECONDS;
  const concurrency = runtime.concurrency ?? SEARCH_CONCURRENCY;
  const completed = await collectSearchSources(
    specs,
    async (spec) => {
      if (stopCollecting) return;
      const source = await searchSource(
        configStore,
        runner,
        clusterId,
        spec,
        options.namespaces,
        options.query,
        limitPerResource,
      );
      sources[spec.resource] = source.rawCount;
      if (source.error) errors.push(source.error);
      results.push(...source.items);
      if (results.length >= options.limit * 2) stopCollecting = true;
    },
    totalTimeoutSeconds,
    concurrency,
  );

  if (!completed) {
    stopCollecting = true;
    errors.push({
      code: "SEARCH_TIMEOUT",
      message: `Global search stopped after ${totalTimeoutSeconds}s. Narrow the query or namespace.`,
      rawStderr: "",
      commandPreview: "",
    });
  }

  const ranked = deduplicateSearchResults(results)
    .sort(compareSearchResults)
    .slice(0, options.limit);
  return {
    items: ranked,
    summary: {
      query: options.query,
      total: ranked.length,
      sources: { ...sources },
      errors: errors.length,
      limited: results.length > ranked.length,
      generatedAt: now().toISOString(),
    },
    errors,
  };
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
  log(`gateway search failed: ${error instanceof Error ? error.message : String(error)}`);
  writeError(response, 500, "SEARCH_FAILED", "Unable to search Kubernetes resources");
}

export function handleSearchRequest(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  configStore: ConfigStore,
  runner: KubectlRunner,
  log: (message: string) => void,
): boolean {
  try {
    const target = matchSearchRoute(request.method, pathname);
    if (!target) return false;
    const options = requestOptions(request);
    void buildSearchResponse(
      configStore,
      runner,
      target.clusterId,
      options,
      log,
    )
      .then((body) => writeJson(response, body))
      .catch((error) => writeRouteError(response, error, log));
    return true;
  } catch (error) {
    writeRouteError(response, error, log);
    return true;
  }
}
