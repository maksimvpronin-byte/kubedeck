import { useEffect, useState } from "react";
import { ApiError, type ApiClient } from "../api";
import type { Cluster, ErrorInfo, Settings, SshAuthMethod } from "../types";
import { normalizeRefreshIntervalSeconds, REFRESH_INTERVAL_OPTIONS_SECONDS } from "../utils/refresh";
import { normalizeSettingsSsh, normalizeSshPort, normalizeSshSettings, saveStoredSshDefaults } from "../utils/sshDefaults";
import { ClusterPanel } from "./ClusterPanel";
import { ResourceCacheDiagnostics } from "./ResourceCacheDiagnostics";
import { WatchDiagnostics } from "./WatchDiagnostics";

export function SettingsPanel({
  api,
  settings,
  save,
  t,
  clusters,
  activeCluster,
  selectedNamespaces,
  resourceTab,
  openingClusterId,
  importKubeconfig,
  openCluster,
  renameCluster,
  removeCluster,
  onError,
}: {
  api: ApiClient | null;
  settings: Settings;
  save: (settings: Settings) => void | Promise<void>;
  t: (key: string) => string;
  clusters: Cluster[];
  activeCluster: Cluster | null;
  selectedNamespaces: string[];
  resourceTab: string;
  openingClusterId: string | null;
  importKubeconfig: () => void;
  openCluster: (cluster: Cluster) => void;
  renameCluster: (cluster: Cluster) => void;
  removeCluster: (cluster: Cluster) => void;
  onError: (error: ErrorInfo | null) => void;
}) {
  const [draft, setDraft] = useState<Settings>(() => normalizeSettings(settings));
  useEffect(() => setDraft(normalizeSettings(settings)), [settings]);
    const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState("");
  const [llmTestStatus, setLlmTestStatus] = useState<"idle" | "testing" | "success" | "error">("idle");
  const [llmTestMessage, setLlmTestMessage] = useState("");

  useEffect(() => {
    if (saveStatus !== "saved") return undefined;
    const timer = window.setTimeout(() => setSaveStatus("idle"), 2500);
    return () => window.clearTimeout(timer);
  }, [saveStatus]);
const selectedRefreshInterval = normalizeRefreshIntervalSeconds(draft.refreshIntervalSeconds);
  const sshSettings = normalizeSshSettings(draft.ssh);
  const llmSettings = normalizeLlmSettings(draft.llm);
  const setSshSettings = (patch: Partial<Settings["ssh"]>) => setDraft({ ...draft, ssh: normalizeSshSettings({ ...sshSettings, ...patch }) });
  const setLlmSettings = (patch: Partial<Settings["llm"]>) => setDraft({ ...draft, llm: normalizeLlmSettings({ ...llmSettings, ...patch }) });
  const saveDraft = async () => {
    setSaveStatus("saving");
    setSaveError("");
    try {
      const normalizedSsh = normalizeSshSettings({
        ...sshSettings,
        defaultUsername: sshSettings.defaultUsername.trim(),
        defaultPort: normalizeSshPort(sshSettings.defaultPort),
        jumpHost: sshSettings.jumpHost.trim(),
        jumpPort: normalizeSshPort(sshSettings.jumpPort),
        jumpUsername: sshSettings.jumpUsername.trim(),
      });
      saveStoredSshDefaults(normalizedSsh);
      await Promise.resolve(save({
        ...draft,
        refreshIntervalSeconds: selectedRefreshInterval,
        llm: normalizeLlmSettings(llmSettings),
        ssh: normalizedSsh,
      }));
      setSaveStatus("saved");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setSaveError(message);
      setSaveStatus("error");
    }
  };
  const testLlmConnection = async () => {
    if (!api) return;
    setLlmTestStatus("testing");
    setLlmTestMessage("");
    try {
      const result = await api.testLlm(normalizeLlmSettings(llmSettings));
      setLlmTestStatus(result.ok ? "success" : "error");
      setLlmTestMessage(result.ok ? t("llm.connectionSuccessful") : `${t("llm.connectionFailed")}: ${result.message}`);
    } catch (error) {
      const message = error instanceof ApiError ? error.info.message : String(error);
      setLlmTestStatus("error");
      setLlmTestMessage(`${t("llm.connectionFailed")}: ${message}`);
    }
  };
  return (
    <section className="settings-panel">
      <h2>{t("nav.settings")}</h2>
      <label>
        {t("settings.kubectlPath")}
        <input value={draft.kubectlPath} onChange={(event) => setDraft({ ...draft, kubectlPath: event.target.value })} />
      </label>
      <label>
        {t("settings.theme")}
        <select value={draft.theme} onChange={(event) => setDraft({ ...draft, theme: event.target.value as Settings["theme"] })}>
          <option value="system">{t("settings.theme.system")}</option>
          <option value="dark">{t("settings.theme.dark")}</option>
          <option value="light">{t("settings.theme.light")}</option>
        </select>
      </label>
      <label>
        {t("settings.language")}
        <select value={draft.language} onChange={(event) => setDraft({ ...draft, language: event.target.value as Settings["language"] })}>
          <option value="system">{t("settings.language.system")}</option>
          <option value="ru">ru</option>
          <option value="en">en</option>
        </select>
      </label>
      <label>
        {t("settings.refresh")}
        <select value={String(selectedRefreshInterval)} onChange={(event) => setDraft({ ...draft, refreshIntervalSeconds: Number(event.target.value) })}>
          {REFRESH_INTERVAL_OPTIONS_SECONDS.map((seconds) => (
            <option key={seconds} value={seconds}>
              {seconds === 0 ? t("settings.refresh.off") : t(`settings.refresh.${seconds}s`)}
            </option>
          ))}
        </select>
      </label>

      <div className="settings-card settings-ssh-card">
        <h3>{t("settings.ssh.title")}</h3>
        <p className="settings-hint">{t("settings.ssh.description")}</p>
        <div className="settings-grid-two">
          <label>
            {t("settings.ssh.defaultUsername")}
            <input value={sshSettings.defaultUsername} onChange={(event) => setSshSettings({ defaultUsername: event.target.value })} placeholder="pronin.mv_adm" />
          </label>
          <label>
            {t("settings.ssh.defaultPort")}
            <input type="number" min="1" max="65535" value={sshSettings.defaultPort} onChange={(event) => setSshSettings({ defaultPort: normalizeSshPort(event.target.value) })} />
          </label>
          <label>
            {t("settings.ssh.defaultAuthMethod")}
            <select value={sshSettings.defaultAuthMethod} onChange={(event) => setSshSettings({ defaultAuthMethod: event.target.value as SshAuthMethod })}>
              <option value="agent">{t("settings.ssh.auth.agent")}</option>
              <option value="password">{t("settings.ssh.auth.password")}</option>
              <option value="privateKey">{t("settings.ssh.auth.privateKey")}</option>
            </select>
          </label>
        </div>
        <label className="settings-checkbox">
          <input type="checkbox" checked={sshSettings.useJumpHost} onChange={(event) => setSshSettings({ useJumpHost: event.target.checked })} />
          {t("settings.ssh.useJumpHost")}
        </label>
        {sshSettings.useJumpHost ? (
          <div className="settings-grid-two">
            <label>
              {t("settings.ssh.jumpHost")}
              <input value={sshSettings.jumpHost} onChange={(event) => setSshSettings({ jumpHost: event.target.value })} placeholder="jump.example.local" />
            </label>
            <label>
              {t("settings.ssh.jumpPort")}
              <input type="number" min="1" max="65535" value={sshSettings.jumpPort} onChange={(event) => setSshSettings({ jumpPort: normalizeSshPort(event.target.value) })} />
            </label>
            <label>
              {t("settings.ssh.jumpUsername")}
              <input value={sshSettings.jumpUsername} onChange={(event) => setSshSettings({ jumpUsername: event.target.value })} placeholder={sshSettings.defaultUsername || t("settings.ssh.sameAsTarget")} />
            </label>
            <label>
              {t("settings.ssh.jumpAuthMethod")}
              <select value={sshSettings.jumpAuthMethod} onChange={(event) => setSshSettings({ jumpAuthMethod: event.target.value as SshAuthMethod })}>
                <option value="agent">{t("settings.ssh.auth.agent")}</option>
                <option value="password">{t("settings.ssh.auth.password")}</option>
                <option value="privateKey">{t("settings.ssh.auth.privateKey")}</option>
              </select>
            </label>
          </div>
        ) : null}
        <p className="settings-warning">{t("settings.ssh.noSecrets")}</p>
      </div>
      <div className="settings-card settings-llm-card">
        <h3>{t("llm.settingsTitle")}</h3>
        <p className="settings-hint">{t("llm.settingsDescription")}</p>
        <label className="settings-checkbox">
          <input type="checkbox" checked={llmSettings.enabled} onChange={(event) => setLlmSettings({ enabled: event.target.checked })} />
          {t("llm.enable")}
        </label>
        <div className="settings-grid-two">
          <label>
            {t("llm.provider")}
            <select value={llmSettings.provider} onChange={(event) => setLlmSettings({ provider: event.target.value as Settings["llm"]["provider"] })}>
              <option value="openai_compatible">{t("llm.provider.openaiCompatible")}</option>
            </select>
          </label>
          <label>
            {t("llm.baseUrl")}
            <input value={llmSettings.baseUrl} onChange={(event) => setLlmSettings({ baseUrl: event.target.value })} placeholder="http://127.0.0.1:1234/v1" />
          </label>
          <label>
            {t("llm.model")}
            <input value={llmSettings.model} onChange={(event) => setLlmSettings({ model: event.target.value })} placeholder="local-model" />
          </label>
          <label>
            {t("llm.apiKey")}
            <input type="password" value={llmSettings.apiKey} onChange={(event) => setLlmSettings({ apiKey: event.target.value })} autoComplete="off" />
          </label>
          <label>
            {t("llm.temperature")}
            <input type="number" min="0" max="2" step="0.1" value={llmSettings.temperature} onChange={(event) => setLlmSettings({ temperature: Number(event.target.value) })} />
          </label>
          <label>
            {t("llm.timeout")}
            <input type="number" min="1" max="600" value={llmSettings.timeoutSeconds} onChange={(event) => setLlmSettings({ timeoutSeconds: Number(event.target.value) })} />
          </label>
          <label>
            {t("llm.maxContextChars")}
            <input type="number" min="1000" max="250000" step="1000" value={llmSettings.maxContextChars} onChange={(event) => setLlmSettings({ maxContextChars: Number(event.target.value) })} />
          </label>
          <label>
            {t("llm.maxOutputTokens")}
            <input
              type="number"
              value={llmSettings.maxOutputTokens}
              onChange={(event) => setLlmSettings({ maxOutputTokens: Number(event.target.value) })}
            />
          </label>
        </div>
        <div className="settings-actions settings-llm-actions">
          
          <button onClick={() => void testLlmConnection()} disabled={!api || llmTestStatus === "testing"}>
            {llmTestStatus === "testing" ? t("llm.testing") : t("llm.testConnection")}
          </button>
          {llmTestStatus !== "idle" && llmTestStatus !== "testing" ? (
            <span className={`settings-save-feedback ${llmTestStatus === "error" ? "error" : "success"}`}>{llmTestMessage}</span>
          ) : null}
        </div>
      </div>
      <div className="settings-actions">
        <button className="primary" onClick={() => void saveDraft()} disabled={saveStatus === "saving"}>{saveStatus === "saving" ? t("settings.saving") : t("settings.save")}</button>
        {saveStatus !== "idle" ? (
          <span className={`settings-save-feedback ${saveStatus === "error" ? "error" : "success"}`}>
            {saveStatus === "error" ? `${t("settings.saveFailed")}: ${saveError}` : t("settings.saved")}
          </span>
        ) : null}
        <button onClick={() => window.kubedeck.openLogsFolder()}>{t("settings.logs")}</button>
      </div>
      <ResourceCacheDiagnostics api={api} activeCluster={activeCluster} t={t} onError={onError} />
      <WatchDiagnostics
        api={api}
        activeCluster={activeCluster}
        selectedNamespaces={selectedNamespaces}
        resourceTab={resourceTab}
        t={t}
        onError={onError}
      />
      <ClusterPanel
        clusters={clusters}
        activeCluster={activeCluster}
        openingClusterId={openingClusterId}
        importKubeconfig={importKubeconfig}
        openCluster={openCluster}
        renameCluster={renameCluster}
        removeCluster={removeCluster}
        t={t}
      />
    </section>
  );
}

function normalizeSettings(settings: Settings): Settings {
  return {
    ...normalizeSettingsSsh(settings),
    llm: normalizeLlmSettings(settings.llm),
  };
}

function normalizeLlmSettings(settings: Partial<Settings["llm"]> | undefined): Settings["llm"] {
  return {
    enabled: Boolean(settings?.enabled),
    provider: "openai_compatible",
    baseUrl: settings?.baseUrl ?? "",
    model: settings?.model ?? "",
    apiKey: settings?.apiKey ?? "",
    temperature: clampNumber(settings?.temperature, 0, 2, 0.2),
    timeoutSeconds: clampNumber(settings?.timeoutSeconds, 1, 600, 60),
    maxContextChars: clampNumber(settings?.maxContextChars, 1000, 250000, 60000), maxOutputTokens: clampNumber(settings?.maxOutputTokens, 256, 32768, 4096),
  };
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numberValue)) return fallback;
  return Math.min(max, Math.max(min, numberValue));
}
