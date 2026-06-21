import fs, { type Stats } from "node:fs";
import path from "node:path";
import { ensureAppPaths, type AppPaths } from "./paths";
import type {
  AppConfig,
  Cluster,
  Language,
  LlmSettings,
  Settings,
  SshAuthMethod,
  SshSettings,
  Theme,
} from "./types";

const LANGUAGES = new Set<Language>(["system", "ru", "en"]);
const THEMES = new Set<Theme>(["system", "dark", "light"]);
const SSH_AUTH_METHODS = new Set<SshAuthMethod>(["agent", "password", "privateKey"]);

function utcNow(): string {
  return new Date().toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asFiniteNumber(value: unknown, fallback: number): number {
  const numberValue = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

function asInteger(value: unknown, fallback: number): number {
  return Math.trunc(asFiniteNumber(value, fallback));
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function defaultLlmSettings(): LlmSettings {
  return {
    enabled: false,
    provider: "openai_compatible",
    baseUrl: "",
    model: "",
    apiKey: "",
    temperature: 0.2,
    timeoutSeconds: 60,
    maxContextChars: 60000,
    maxOutputTokens: 4096,
  };
}

export function defaultSshSettings(): SshSettings {
  return {
    defaultUsername: "",
    defaultPort: 22,
    defaultAuthMethod: "agent",
    useJumpHost: false,
    jumpHost: "",
    jumpPort: 22,
    jumpUsername: "",
    jumpAuthMethod: "agent",
  };
}

export function defaultSettings(): Settings {
  return {
    kubectlPath: String(process.env.KUBEDECK_KUBECTL_PATH ?? "").trim() || "kubectl",
    language: "system",
    theme: "system",
    refreshIntervalSeconds: 10,
    logsTailLines: 500,
    secretRevealTimeoutSeconds: 30,
    restartProblemThreshold: 3,
    terminalFontSize: 13,
    logsSince: "",
    llm: defaultLlmSettings(),
    ssh: defaultSshSettings(),
  };
}

export function defaultConfig(): AppConfig {
  return {
    clusters: [],
    settings: defaultSettings(),
  };
}

function normalizeLlmSettings(value: unknown): LlmSettings {
  const input = isRecord(value) ? value : {};
  return {
    enabled: asBoolean(input.enabled, false),
    provider: "openai_compatible",
    baseUrl: asString(input.baseUrl).trim(),
    model: asString(input.model).trim(),
    apiKey: asString(input.apiKey).trim(),
    temperature: clamp(asFiniteNumber(input.temperature, 0.2), 0, 2),
    timeoutSeconds: clamp(asInteger(input.timeoutSeconds, 60), 1, 600),
    maxContextChars: clamp(asInteger(input.maxContextChars, 60000), 1000, 250000),
    maxOutputTokens: asInteger(input.maxOutputTokens, 4096),
  };
}

function normalizeSshSettings(value: unknown): SshSettings {
  const input = isRecord(value) ? value : {};
  const defaultPort = asInteger(input.defaultPort, 22);
  const jumpPort = asInteger(input.jumpPort, 22);

  if (defaultPort < 1 || defaultPort > 65535) {
    throw new Error("SSH default port must be between 1 and 65535");
  }
  if (jumpPort < 1 || jumpPort > 65535) {
    throw new Error("SSH jump port must be between 1 and 65535");
  }

  const defaultAuthMethod = asString(input.defaultAuthMethod, "agent") as SshAuthMethod;
  const jumpAuthMethod = asString(input.jumpAuthMethod, "agent") as SshAuthMethod;

  if (!SSH_AUTH_METHODS.has(defaultAuthMethod)) {
    throw new Error("Invalid SSH default authentication method");
  }
  if (!SSH_AUTH_METHODS.has(jumpAuthMethod)) {
    throw new Error("Invalid SSH jump authentication method");
  }

  return {
    defaultUsername: asString(input.defaultUsername).trim(),
    defaultPort,
    defaultAuthMethod,
    useJumpHost: asBoolean(input.useJumpHost, false),
    jumpHost: asString(input.jumpHost).trim(),
    jumpPort,
    jumpUsername: asString(input.jumpUsername).trim(),
    jumpAuthMethod,
  };
}

export function normalizeSettings(value: unknown): Settings {
  if (!isRecord(value)) {
    throw new Error("settings must be an object");
  }

  const defaults = defaultSettings();
  const language = asString(value.language, defaults.language) as Language;
  const theme = asString(value.theme, defaults.theme) as Theme;

  if (!LANGUAGES.has(language)) {
    throw new Error(`Unsupported language: ${language}`);
  }
  if (!THEMES.has(theme)) {
    throw new Error(`Unsupported theme: ${theme}`);
  }

  return {
    kubectlPath: asString(value.kubectlPath, defaults.kubectlPath).trim(),
    language,
    theme,
    refreshIntervalSeconds: asInteger(value.refreshIntervalSeconds, defaults.refreshIntervalSeconds),
    logsTailLines: asInteger(value.logsTailLines, defaults.logsTailLines),
    secretRevealTimeoutSeconds: asInteger(
      value.secretRevealTimeoutSeconds,
      defaults.secretRevealTimeoutSeconds,
    ),
    restartProblemThreshold: asInteger(
      value.restartProblemThreshold,
      defaults.restartProblemThreshold,
    ),
    terminalFontSize: asInteger(value.terminalFontSize, defaults.terminalFontSize),
    logsSince: asString(value.logsSince, defaults.logsSince),
    llm: normalizeLlmSettings(value.llm),
    ssh: normalizeSshSettings(value.ssh),
  };
}

function normalizeCluster(value: unknown): Cluster {
  if (!isRecord(value)) {
    throw new Error("cluster must be an object");
  }

  const id = asString(value.id).trim();
  const displayName = asString(value.displayName).trim();
  const kubeconfigPath = asString(value.kubeconfigPath).trim();

  if (!id || !displayName || !kubeconfigPath) {
    throw new Error("cluster id, displayName and kubeconfigPath are required");
  }

  return {
    id,
    displayName,
    kubeconfigPath,
    lastOpened: asBoolean(value.lastOpened, false),
    createdAt: asString(value.createdAt, utcNow()),
    updatedAt: asString(value.updatedAt, utcNow()),
  };
}

export function normalizeConfig(value: unknown): AppConfig {
  if (!isRecord(value)) {
    throw new Error("config must be an object");
  }

  const rawClusters = value.clusters;
  if (rawClusters !== undefined && !Array.isArray(rawClusters)) {
    throw new Error("clusters must be an array");
  }

  return {
    clusters: (rawClusters ?? []).map(normalizeCluster),
    settings: normalizeSettings(value.settings ?? defaultSettings()),
  };
}

export function validateKubectlPath(value: string): void {
  const text = String(value ?? "").trim();
  if (!text) {
    throw new Error("kubectlPath must not be empty");
  }

  if (text === "kubectl" || text === "kubectl.exe") {
    return;
  }

  const fileName = path.basename(text).toLowerCase();
  if (fileName !== "kubectl" && fileName !== "kubectl.exe") {
    throw new Error("kubectlPath must point to kubectl or kubectl.exe");
  }

  let stat: Stats;
  try {
    stat = fs.statSync(text);
  } catch {
    throw new Error(`kubectlPath does not exist: ${text}`);
  }

  if (!stat.isFile()) {
    throw new Error(`kubectlPath does not exist: ${text}`);
  }
}

export class ConfigStore {
  readonly paths: AppPaths;

  constructor(rootOverride?: string) {
    this.paths = ensureAppPaths(rootOverride);
    if (!fs.existsSync(this.paths.config)) {
      this.save(defaultConfig(), false);
    }
  }

  load(): AppConfig {
    try {
      const raw = fs.readFileSync(this.paths.config, "utf8");
      return normalizeConfig(JSON.parse(raw));
    } catch {
      const brokenPath = path.join(this.paths.root, "config.broken.json");
      try {
        fs.copyFileSync(this.paths.config, brokenPath);
      } catch {
        // Best effort only.
      }

      try {
        fs.rmSync(this.paths.config, { force: true });
      } catch {
        // The following save will report a useful error if the file is locked.
      }

      return this.save(defaultConfig(), false);
    }
  }

  save(config: AppConfig, createBackup = true): AppConfig {
    const normalized = normalizeConfig(config);
    const serialized = `${JSON.stringify(normalized, null, 2)}\n`;
    const temporaryPath = `${this.paths.config}.${process.pid}.${Date.now()}.tmp`;
    const backupPath = path.join(this.paths.root, "config.backup.json");

    fs.writeFileSync(temporaryPath, serialized, "utf8");

    try {
      if (createBackup && fs.existsSync(this.paths.config)) {
        fs.copyFileSync(this.paths.config, backupPath);
      }
      fs.renameSync(temporaryPath, this.paths.config);
    } catch (error) {
      fs.rmSync(temporaryPath, { force: true });
      throw error;
    }

    return normalized;
  }

  updateSettings(value: unknown): AppConfig {
    const settings = normalizeSettings(value);
    validateKubectlPath(settings.kubectlPath);

    const config = this.load();
    config.settings = settings;
    return this.save(config);
  }
}
