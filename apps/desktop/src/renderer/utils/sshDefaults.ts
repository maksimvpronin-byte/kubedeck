import type { Settings, SshAuthMethod } from "../types";

export const SSH_DEFAULTS_STORAGE_KEY = "kubedeck:sshDefaults.v1";

export const DEFAULT_SSH_SETTINGS: Settings["ssh"] = {
  defaultUsername: "",
  defaultPort: 22,
  defaultAuthMethod: "agent",
  useJumpHost: false,
  jumpHost: "",
  jumpPort: 22,
  jumpUsername: "",
  jumpAuthMethod: "agent",
};

function normalizeAuthMethod(value: unknown): SshAuthMethod {
  return value === "password" || value === "privateKey" ? value : "agent";
}

export function normalizeSshPort(value: unknown, fallback = 22): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(65535, Math.max(1, Math.trunc(parsed)));
}

export function normalizeSshSettings(value?: Partial<Settings["ssh"]> | null): Settings["ssh"] {
  return {
    ...DEFAULT_SSH_SETTINGS,
    ...(value ?? {}),
    defaultUsername: String(value?.defaultUsername ?? DEFAULT_SSH_SETTINGS.defaultUsername).trim(),
    defaultPort: normalizeSshPort(value?.defaultPort, DEFAULT_SSH_SETTINGS.defaultPort),
    defaultAuthMethod: normalizeAuthMethod(value?.defaultAuthMethod),
    useJumpHost: Boolean(value?.useJumpHost),
    jumpHost: String(value?.jumpHost ?? DEFAULT_SSH_SETTINGS.jumpHost).trim(),
    jumpPort: normalizeSshPort(value?.jumpPort, DEFAULT_SSH_SETTINGS.jumpPort),
    jumpUsername: String(value?.jumpUsername ?? DEFAULT_SSH_SETTINGS.jumpUsername).trim(),
    jumpAuthMethod: normalizeAuthMethod(value?.jumpAuthMethod),
  };
}

export function normalizeSettingsSsh(settings: Settings): Settings {
  return {
    ...settings,
    ssh: normalizeSshSettings(settings.ssh),
  };
}

export function loadStoredSshDefaults(): Settings["ssh"] | null {
  if (typeof window === "undefined" || !window.localStorage) return null;
  try {
    const raw = window.localStorage.getItem(SSH_DEFAULTS_STORAGE_KEY);
    if (!raw) return null;
    return normalizeSshSettings(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function saveStoredSshDefaults(settings: Settings["ssh"]): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.setItem(SSH_DEFAULTS_STORAGE_KEY, JSON.stringify(normalizeSshSettings(settings)));
  } catch {
    // Local persistence is only a renderer-side fallback. Backend config remains the source of truth.
  }
}

function hasMeaningfulSshDefaults(settings?: Partial<Settings["ssh"]> | null): boolean {
  if (!settings) return false;
  return Boolean(
    String(settings.defaultUsername ?? "").trim() ||
    settings.defaultPort !== undefined && Number(settings.defaultPort) !== DEFAULT_SSH_SETTINGS.defaultPort ||
    settings.defaultAuthMethod && settings.defaultAuthMethod !== DEFAULT_SSH_SETTINGS.defaultAuthMethod ||
    settings.useJumpHost ||
    String(settings.jumpHost ?? "").trim() ||
    settings.jumpPort !== undefined && Number(settings.jumpPort) !== DEFAULT_SSH_SETTINGS.jumpPort ||
    String(settings.jumpUsername ?? "").trim() ||
    settings.jumpAuthMethod && settings.jumpAuthMethod !== DEFAULT_SSH_SETTINGS.jumpAuthMethod
  );
}

export function resolveSshDefaults(settings?: Settings | null): Settings["ssh"] {
  const configDefaults = normalizeSshSettings(settings?.ssh);
  if (hasMeaningfulSshDefaults(settings?.ssh)) return configDefaults;
  const stored = loadStoredSshDefaults();
  return stored ?? configDefaults;
}
