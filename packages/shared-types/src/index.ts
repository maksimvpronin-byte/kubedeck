export type Theme = "system" | "dark" | "light";
export type Language = "system" | "ru" | "en";

export interface LlmSettings {
  enabled: boolean;
  baseUrl: string;
  model: string;
  apiKeyRef: string;
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
}

export interface Cluster {
  id: string;
  displayName: string;
  kubeconfigPath: string;
  lastOpened: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ErrorInfo {
  code: string;
  message: string;
  rawStderr: string;
  commandPreview: string;
}
