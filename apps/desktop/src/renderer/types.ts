import type { ErrorInfo, SshSettings } from "@kubedeck/shared-types";

export type { AppConfig, Cluster, ErrorInfo, Language, LlmSettings, Settings, SshAuthMethod, SshSettings, Theme } from "@kubedeck/shared-types";
export type AppFolder = "root" | "logs" | "config" | "kubeconfigs";

export interface LlmStatus {
  enabled: boolean;
  configured: boolean;
  provider: "openai_compatible";
  baseUrl: string;
  model: string;
}

export interface LlmTestResponse {
  ok: boolean;
  message: string;
  code?: string;
  model?: string;
  elapsedMs?: number;
  status: LlmStatus;
}

export interface LlmAnalyzeResourceRequest {
  clusterId: string;
  resource: string;
  kind?: string;
  namespace?: string;
  name: string;
  resourceObject: Record<string, unknown>;
  yaml?: string;
  events?: ResourceRow[];
  describe?: string;
  relatedResources?: RelatedLink[];
  userRequest?: string;
  language?: string;
}

export interface LlmAnalyzeResourceResponse {
  answer: string;
  model: string;
  elapsedMs: number;
  contextChars: number;
  truncated: boolean; maxOutputTokens: number;
}
export interface LlmPromptPreviewResponse {
  messages: Array<{ role: string; content: string }>;
  context: string;
  contextChars: number;
  truncated: boolean; maxOutputTokens: number;
}


export interface DesktopInfo {
  appName: string;
  appVersion: string;
  electronVersion: string;
  chromeVersion: string;
  nodeVersion: string;
  platform: string;
  arch: string;
  isPackaged: boolean;
  paths: Record<AppFolder, string>;
}

export interface BackendInfo {
  service: string;
  backendVersion: string;
  pythonVersion: string;
  platform: string;
  processId: number;
  paths: Record<AppFolder, string>;
  settings: {
    kubectlPath: string;
    refreshIntervalSeconds: number;
    logsTailLines: number;
    language: string;
    theme: string;
    llm?: LlmStatus;
    ssh?: SshSettings;
  };
  clusters: number;
}

export interface ResourceRow {
  uid: string;
  name: string;
  namespace?: string;
  createdAt?: string;
  [key: string]: unknown;
}



export interface GlobalSearchItem extends ResourceRow {
  resource: string;
  kind: string;
  namespace?: string;
  score: number;
  matchedFields: string[];
  source: "global-search";
  title?: string;
  subtitle?: string;
  crdInstance?: boolean;
}

export interface GlobalSearchSummary {
  query: string;
  total: number;
  sources: Record<string, number>;
  errors: number;
  limited: boolean;
  generatedAt: string;
}

export interface GlobalSearchResponse {
  items: GlobalSearchItem[];
  summary: GlobalSearchSummary;
  errors: Array<ErrorInfo & { resource?: string; namespace?: string }>;
}

export interface ProblemsSummary {
  total: number;
  critical: number;
  warning: number;
  info: number;
  errors: number;
  generatedAt: string;
  sources: Record<string, number>;
  categories?: Record<string, number>;
  kinds?: Record<string, number>;
}

export interface ProblemsResponse {
  items: ResourceRow[];
  summary: ProblemsSummary;
  errors: Array<ErrorInfo & { resource?: string; namespace?: string }>;
}

export interface AuditEvent {
  timestamp: string;
  action: string;
  status: string;
  clusterId?: string;
  namespace?: string;
  resource?: string;
  name?: string;
  commandPreview?: string;
  message?: string;
  extra?: Record<string, unknown>;
}

export interface AuditResponse {
  items: AuditEvent[];
  limit: number;
}


export interface RelatedLink {
  key: string;
  resource: string;
  namespace: string;
  name: string;
  kind: string;
  relation: string;
  detail?: string;
}

export interface RelatedResourcesResponse {
  items: RelatedLink[];
  sources: Record<string, number>;
  errors: Array<ErrorInfo & { resource?: string; namespace?: string }>;
}


export interface DeploymentLogPodTarget {
  name: string;
  phase: string;
  containers: string[];
}

export interface DeploymentLogTargetsResponse {
  namespace: string;
  name: string;
  pods: DeploymentLogPodTarget[];
  containers: string[];
}

export interface ResourceEventsResponse {
  items: ResourceRow[];
  rawCount: number;
}

export interface SecretKeyInfo {
  key: string;
  encodedBytes: number;
  decodedBytes: number;
  validBase64: boolean;
  binary: boolean;
}

export interface SecretKeysResponse {
  type: string;
  immutable: boolean;
  namespace: string;
  name: string;
  keys: SecretKeyInfo[];
  revealTimeoutSeconds: number;
}

export interface SecretRevealResponse {
  key: string;
  value: string;
  decodedBytes: number;
  binary: boolean;
  revealTimeoutSeconds: number;
}

export interface ResourceDefinition {
  name: string;
  shortNames: string;
  apiGroup: string;
  namespaced: boolean;
  kind: string;
  verbs: string;
}

export interface PortForwardSession {
  id: string;
  clusterId: string;
  namespace: string;
  resource: string;
  name: string;
  localPort: number;
  remotePort: number;
  status: string;
  pid: number;
  startedAt: string;
  commandPreview: string;
  url: string;
  source?: "kubedeck" | "external";
  stoppable?: boolean;
}

export interface PortForwardStartRequest {
  namespace: string;
  resource: string;
  name: string;
  /** 0 means backend should auto-pick a free local port. */
  localPort: number;
  remotePort: number;
}

export interface CommandResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  commandPreview: string;
  returnCode: number | null;
}

export type Section =
  | "nodes"
  | "problems"
  | "namespaces"
  | "rbac"
  | "workloads"
  | "network"
  | "storage"
  | "config"
  | "crd"
  | "events"
  | "audit"
  | "about"
  | "port-forwards"
  | "help"
  | "settings";

export interface ResourceCacheEntry {
  clusterId: string;
  resource: string;
  namespace: string;
  items?: number;
  rawCount?: number;
  ageSeconds: number;
  ttlSeconds: number;
  hits: number;
}

export interface ResourceCacheStatus {
  enabled: boolean;
  mode: string;
  entries: number;
  items: ResourceCacheEntry[];
  resourcePollingEnabled?: boolean;
  discoveryCacheEnabled?: boolean;
  resourceListCacheEnabled?: boolean;
  resourceListTtlSeconds?: number;
  note?: string;
}

export interface WatchSession {
  id: string;
  clusterId: string;
  resource: string;
  namespace: string;
  status: "running" | "stopping" | "stopped" | "failed" | string;
  pid?: number | null;
  startedAt: number;
  updatedAt: number;
  ageSeconds: number;
  stdoutLines: number;
  stderrLines: number;
  cacheEvents?: number;
  cacheInvalidations?: number;
  exitCode?: number | null;
  stoppedByUser: boolean;
  commandPreview: string;
  outputTail: string[];
  errorTail: string[];
  alreadyRunning?: boolean;
}


export interface ResourceWatchEvent {
  type: "resource.changed" | "status" | string;
  data?: string;
  clusterId?: string;
  watchId?: string;
  resource?: string;
  namespace?: string;
  name?: string;
  eventType?: string;
  cacheInvalidations?: number;
  at?: number;
}

export interface WatchStatus {
  enabled: boolean;
  mode: string;
  running: number;
  total: number;
  watches: WatchSession[];
  note?: string;
}
