export type DarkTheme = "midnight" | "nord" | "forest" | "plum" | "mocha" | "graphite";
export type Theme = "system" | "light" | DarkTheme;
export type Language = "system" | "ru" | "en";
export type SshAuthMethod = "agent" | "password" | "privateKey";

export interface LlmSettings {
  enabled: boolean;
  provider: "openai_compatible";
  baseUrl: string;
  model: string;
  apiKeyConfigured: boolean;
  temperature: number;
  timeoutSeconds: number;
  maxContextChars: number;
  maxOutputTokens: number;
}

export type ApiKeyUpdate =
  | { action: "keep" }
  | { action: "replace"; value: string }
  | { action: "clear" };

export interface SshSettings {
  defaultUsername: string;
  defaultPort: number;
  defaultAuthMethod: SshAuthMethod;
  useJumpHost: boolean;
  jumpHost: string;
  jumpPort: number;
  jumpUsername: string;
  jumpAuthMethod: SshAuthMethod;
}

export interface Settings {
  kubectlPath: string;
  language: Language;
  theme: Theme;
  refreshIntervalSeconds: number;
  logsTailLines: number;
  secretRevealTimeoutSeconds: number;
  restartProblemThreshold: number;
  terminalFontSize: number;
  logsSince: string;
  llm: LlmSettings;
  ssh: SshSettings;
}

export interface Cluster {
  id: string;
  displayName: string;
  kubeconfigPath: string;
  lastOpened: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AppConfig {
  clusters: Cluster[];
  settings: Settings;
  // Runtime state, not persisted configuration: which clusters KubeDeck is
  // currently allowed to talk to on its own. Absent on responses that predate
  // the connect/disconnect control.
  connectedClusterIds?: string[];
}

export interface ErrorInfo {
  code: string;
  message: string;
  rawStderr: string;
  commandPreview: string;
}
