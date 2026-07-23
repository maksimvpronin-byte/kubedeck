import type { AppConfig, AuditResponse, BackendInfo, Cluster, CommandResult, ErrorInfo, PortForwardSession, PortForwardStartRequest, GlobalSearchResponse, ProblemsResponse, RelatedResourcesResponse, ResourceDefinition, ResourceEventsResponse, ResourceRow, SecretKeysResponse, SecretRevealResponse, Settings, DeploymentLogTargetsResponse, ResourceCacheStatus, WatchSession, WatchStatus, ResourceWatchEvent, LlmAnalyzeResourceRequest, LlmAnalyzeResourceResponse, LlmPromptPreviewResponse, LlmStatus, LlmTestResponse } from "./types";

export class ApiError extends Error {
  info: ErrorInfo;

  constructor(info: ErrorInfo) {
    super(info.message);
    this.info = info;
  }
}

async function parseApiErrorResponse(response: Response): Promise<ErrorInfo> {
  let detail: ErrorInfo = { code: "HTTP_ERROR", message: response.statusText, rawStderr: "", commandPreview: "" };
  const text = await response.text();
  try {
    const body = JSON.parse(text);
    if (isErrorInfo(body.detail)) {
      detail = body.detail;
    } else if (typeof body.detail === "string") {
      detail.message = body.detail || response.statusText;
    }
  } catch {
    detail.message = text || response.statusText;
  }
  return detail;
}

function isErrorInfo(value: unknown): value is ErrorInfo {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.code === "string" &&
    typeof candidate.message === "string" &&
    typeof candidate.rawStderr === "string" &&
    typeof candidate.commandPreview === "string"
  );
}

type OperationConfirmation = {
  clusterId: string;
  action: string;
  typedName: string;
  namespace?: string;
  resource?: string;
  name?: string;
  commandPreviewHash?: string;
};

export class ApiClient {
  constructor(private baseUrl: string, private token: string) {}

  async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        "X-KubeDeck-Token": this.token,
        ...(init?.headers ?? {}),
      },
    });
    if (!response.ok) {
      throw new ApiError(await parseApiErrorResponse(response));
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      return (await response.json()) as T;
    }
    return (await response.text()) as T;
  }

  health() {
    return this.request<{ ok: boolean }>("/health");
  }

  config() {
    return this.request<AppConfig>("/config");
  }

  appInfo(signal?: AbortSignal) {
    return this.request<BackendInfo>("/app/info", { signal });
  }

  updateSettings(settings: Settings) {
    return this.request<AppConfig>("/settings", { method: "PUT", body: JSON.stringify({ settings }) });
  }

  llmStatus() {
    return this.request<LlmStatus>("/llm/status");
  }

  testLlm(settings?: Settings["llm"]) {
    return this.request<LlmTestResponse>("/llm/test", {
      method: "POST",
      body: JSON.stringify(settings ? { settings } : {}),
    });
  }

  analyzeResourceWithLlm(request: LlmAnalyzeResourceRequest) {
    return this.request<LlmAnalyzeResourceResponse>("/llm/analyze-resource", { method: "POST", body: JSON.stringify(request) });
  }
  previewLlmResourcePrompt(request: LlmAnalyzeResourceRequest) {
    return this.request<LlmPromptPreviewResponse>("/llm/preview-resource-prompt", { method: "POST", body: JSON.stringify(request) });
  }

  kubectlStatus() {
    return this.request<{ ok: boolean; version: { gitVersion?: string }; commandPreview: string }>("/kubectl/status");
  }

  resourceCacheStatus() {
    return this.request<ResourceCacheStatus>("/resource-cache/status");
  }

  clearResourceCache(clusterId?: string) {
    const suffix = clusterId ? `?cluster_id=${encodeURIComponent(clusterId)}` : "";
    return this.request<{ cleared: number }>(`/resource-cache/clear${suffix}`, { method: "POST" });
  }

  watchStatus() {
    return this.request<WatchStatus>("/watches/status");
  }

  startWatch(clusterId: string, resource: string, namespace = "all") {
    return this.request<WatchSession & { alreadyRunning?: boolean }>(`/clusters/${clusterId}/watches`, {
      method: "POST",
      body: JSON.stringify({ resource, namespace }),
    });
  }

  stopWatch(id: string) {
    return this.request<{ ok: boolean; found: boolean; watch?: WatchSession }>(`/watches/${id}`, { method: "DELETE" });
  }

  stopAllWatches() {
    return this.request<{ ok: boolean; stopped: number; watches: WatchSession[] }>("/watches/stop-all", { method: "POST" });
  }

  importCluster(sourcePath: string, displayName?: string) {
    return this.request<Cluster>("/clusters/import", { method: "POST", body: JSON.stringify({ sourcePath, displayName }) });
  }

  renameCluster(id: string, displayName: string) {
    return this.request<Cluster>(`/clusters/${id}`, { method: "PATCH", body: JSON.stringify({ displayName }) });
  }

  reorderClusters(clusterIds: string[]) {
    return this.request<{ clusters: Cluster[] }>("/clusters/order", { method: "PUT", body: JSON.stringify({ clusterIds }) });
  }

  removeCluster(id: string) {
    return this.request<{ ok: boolean }>(`/clusters/${id}`, { method: "DELETE" });
  }

  openCluster(id: string) {
    return this.request<{ cluster: Cluster; namespaces: Array<{ metadata: { name: string } }> }>(`/clusters/${id}/open`, { method: "POST" });
  }

  openLastCluster() {
    return this.request<{ cluster: Cluster | null; namespaces?: Array<{ metadata: { name: string } }> }>("/clusters/last/open", { method: "POST" });
  }

  namespaces(clusterId: string, signal?: AbortSignal) {
    return this.request<{ items: Array<{ metadata: { name: string } }> }>(`/clusters/${clusterId}/namespaces`, { signal });
  }

  resources(
    clusterId: string,
    resource: string,
    namespace: string,
    signal?: AbortSignal,
    options: { useCache?: boolean; forceRefresh?: boolean } = {},
  ) {
    const params = new URLSearchParams({ namespace });
    if (options.useCache) params.set("useCache", "true");
    if (options.forceRefresh) params.set("forceRefresh", "true");
    return this.request<{ items: ResourceRow[]; rawCount: number; cached?: boolean; cacheTtlSeconds?: number }>(`/clusters/${clusterId}/resources/${resource}?${params.toString()}`, { signal });
  }

  resourceDefinitions(clusterId: string) {
    return this.request<{ items: ResourceDefinition[] }>(`/clusters/${clusterId}/resource-definitions`);
  }

  problems(clusterId: string, signal?: AbortSignal) {
    return this.request<ProblemsResponse>(`/clusters/${clusterId}/problems`, { signal });
  }


  audit(limit = 200, signal?: AbortSignal) {
    return this.request<AuditResponse>(`/audit?limit=${encodeURIComponent(String(limit))}`, { signal });
  }

  search(clusterId: string, query: string, namespace = "all", limit = 120, includeCrdInstances = true, signal?: AbortSignal) {
    const params = new URLSearchParams({
      q: query,
      namespace,
      limit: String(limit),
      includeCrdInstances: String(includeCrdInstances),
    });
    return this.request<GlobalSearchResponse>(`/clusters/${clusterId}/search?${params.toString()}`, { signal });
  }

  resourceText(clusterId: string, resource: string, namespace: string, name: string, view: "yaml" | "describe", signal?: AbortSignal) {
    return this.request<string>(`/clusters/${clusterId}/resources/${encodeURIComponent(resource)}/${encodeURIComponent(namespace || "_cluster")}/${encodeURIComponent(name)}/${view}`, { signal });
  }

  resourceMetrics(clusterId: string, resource: string, namespace: string, name: string, signal?: AbortSignal) {
    return this.request<ResourceRow>(`/clusters/${clusterId}/resources/${encodeURIComponent(resource)}/${encodeURIComponent(namespace || "_cluster")}/${encodeURIComponent(name)}/metrics`, { signal });
  }

  resourceEvents(clusterId: string, resource: string, namespace: string, name: string, signal?: AbortSignal) {
    return this.request<ResourceEventsResponse>(`/clusters/${clusterId}/resources/${encodeURIComponent(resource)}/${encodeURIComponent(namespace || "_cluster")}/${encodeURIComponent(name)}/events`, { signal });
  }

  relatedResources(clusterId: string, resource: string, namespace: string, name: string, signal?: AbortSignal) {
    return this.request<RelatedResourcesResponse>(`/clusters/${clusterId}/resources/${encodeURIComponent(resource)}/${encodeURIComponent(namespace || "_cluster")}/${encodeURIComponent(name)}/related`, { signal });
  }

  secretKeys(clusterId: string, namespace: string, name: string, signal?: AbortSignal) {
    return this.request<SecretKeysResponse>(`/clusters/${clusterId}/secrets/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/keys`, { signal });
  }

  revealSecret(clusterId: string, namespace: string, name: string, key: string) {
    return this.request<SecretRevealResponse>(`/clusters/${clusterId}/secrets/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/reveal`, { method: "POST", body: JSON.stringify({ key }) });
  }

  auditSecretCopy(clusterId: string, namespace: string, name: string, key: string) {
    return this.request<{ ok: boolean }>(`/clusters/${clusterId}/secrets/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/copy`, { method: "POST", body: JSON.stringify({ key }) });
  }

  updateSecret(clusterId: string, namespace: string, name: string, key: string, value: string) {
    return this.request<{ ok: boolean }>(`/clusters/${clusterId}/secrets/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/update`, { method: "POST", body: JSON.stringify({ key, value }) });
  }

  dryRunYaml(clusterId: string, yaml: string) {
    return this.request<string>(`/clusters/${clusterId}/yaml/dry-run`, { method: "POST", body: JSON.stringify({ yaml }) });
  }

  applyYaml(clusterId: string, yaml: string, namespace: string, name: string, typedName: string) {
    const confirmation: OperationConfirmation = {
      clusterId,
      action: "apply",
      resource: "yaml",
      namespace: namespace || "_cluster",
      name,
      typedName,
    };
    return this.request<string>(`/clusters/${clusterId}/yaml/apply`, { method: "PUT", body: JSON.stringify({ yaml, confirmation }) });
  }

  resourceAction(clusterId: string, resource: string, namespace: string, name: string, action: string, replicas?: number, typedName = "") {
    const confirmation: OperationConfirmation = {
      clusterId,
      action,
      resource: resource.toLowerCase(),
      namespace: namespace || "_cluster",
      name,
      typedName,
    };
    return this.request<string>(
      `/clusters/${clusterId}/resources/${encodeURIComponent(resource)}/${encodeURIComponent(namespace || "_cluster")}/${encodeURIComponent(name)}/action`,
      { method: "POST", body: JSON.stringify({ action, replicas, confirmation }) }
    );
  }

  podText(clusterId: string, namespace: string, name: string, view: "yaml" | "describe" | "logs", tail = 500, follow = false, signal?: AbortSignal) {
    const suffix = view === "logs" ? `?tail=${tail}&follow=${follow}` : "";
    return this.request<string>(`/clusters/${clusterId}/pods/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/${view}${suffix}`, { signal });
  }

  podLogs(
    clusterId: string,
    namespace: string,
    name: string,
    options: { tail?: number; previous?: boolean; timestamps?: boolean; container?: string; all?: boolean } = {},
    signal?: AbortSignal,
  ) {
    const params = new URLSearchParams({
      previous: String(Boolean(options.previous)),
      timestamps: String(Boolean(options.timestamps)),
    });
    if (options.all) {
      params.set("all", "true");
    } else {
      params.set("tail", String(options.tail ?? 500));
    }
    if (options.container) params.set("container", options.container);
    return this.request<string>(`/clusters/${clusterId}/pods/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/logs?${params.toString()}`, { signal });
  }


  deploymentLogTargets(clusterId: string, namespace: string, name: string, signal?: AbortSignal) {
    return this.request<DeploymentLogTargetsResponse>(`/clusters/${clusterId}/deployments/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/log-targets`, { signal });
  }

  deploymentLogs(
    clusterId: string,
    namespace: string,
    name: string,
    options: { tail?: number; previous?: boolean; timestamps?: boolean; container?: string; pod?: string; all?: boolean } = {},
    signal?: AbortSignal,
  ) {
    const params = new URLSearchParams({
      previous: String(Boolean(options.previous)),
      timestamps: String(Boolean(options.timestamps)),
    });
    if (options.all) {
      params.set("all", "true");
    } else {
      params.set("tail", String(options.tail ?? 500));
    }
    if (options.container) params.set("container", options.container);
    if (options.pod) params.set("pod", options.pod);
    return this.request<string>(`/clusters/${clusterId}/deployments/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/logs?${params.toString()}`, { signal });
  }

  podExec(clusterId: string, namespace: string, name: string, command: string, container?: string, shell = "sh", typedName = "") {
    const confirmation: OperationConfirmation = {
      clusterId,
      action: "exec",
      resource: "pods",
      namespace,
      name,
      typedName,
    };
    return this.request<CommandResult>(
      `/clusters/${clusterId}/pods/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/exec`,
      { method: "POST", body: JSON.stringify({ command, container, shell, confirmation }) }
    );
  }


  resourceWatchEventsUrl(clusterId: string, resource: string, namespace = "all") {
    const url = new URL(this.baseUrl);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = `/clusters/${clusterId}/resources/${encodeURIComponent(resource)}/watch-events`;
    url.searchParams.set("namespace", namespace || "all");
    url.searchParams.set("token", this.token);
    return url.toString();
  }

  parseResourceWatchEvent(raw: string): ResourceWatchEvent | null {
    try {
      const parsed = JSON.parse(raw) as ResourceWatchEvent;
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      return null;
    }
  }

  nodeSshUrl(clusterId: string, name: string) {
    const url = new URL(this.baseUrl);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = `/clusters/${clusterId}/nodes/${encodeURIComponent(name)}/ssh`;
    url.searchParams.set("token", this.token);
    return url.toString();
  }

  podTerminalUrl(clusterId: string, namespace: string, name: string, container?: string, shell = "auto", size?: { cols: number; rows: number }) {
    const url = new URL(this.baseUrl);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = `/clusters/${clusterId}/pods/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/terminal`;
    url.searchParams.set("token", this.token);
    if (container) url.searchParams.set("container", container);
    if (shell) url.searchParams.set("shell", shell);
    if (size && Number.isFinite(size.cols) && Number.isFinite(size.rows) && size.cols > 0 && size.rows > 0) {
      url.searchParams.set("cols", String(Math.trunc(size.cols)));
      url.searchParams.set("rows", String(Math.trunc(size.rows)));
    }
    return url.toString();
  }

  portForwards() {
    return this.request<{ items: PortForwardSession[] }>("/port-forwards");
  }

  startPortForward(clusterId: string, request: PortForwardStartRequest) {
    return this.request<PortForwardSession>(`/clusters/${clusterId}/port-forwards`, { method: "POST", body: JSON.stringify(request) });
  }

  stopPortForward(id: string) {
    return this.request<{ ok: boolean }>(`/port-forwards/${id}`, { method: "DELETE" });
  }
}
