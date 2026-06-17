import { useEffect, useState } from "react";
import type { ApiClient } from "../api";
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
  save: (settings: Settings) => void;
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
  const [draft, setDraft] = useState<Settings>(() => normalizeSettingsSsh(settings));
  useEffect(() => setDraft(normalizeSettingsSsh(settings)), [settings]);
  const selectedRefreshInterval = normalizeRefreshIntervalSeconds(draft.refreshIntervalSeconds);
  const sshSettings = normalizeSshSettings(draft.ssh);
  const setSshSettings = (patch: Partial<Settings["ssh"]>) => setDraft({ ...draft, ssh: normalizeSshSettings({ ...sshSettings, ...patch }) });
  const saveDraft = () => {
    const normalizedSsh = normalizeSshSettings({
      ...sshSettings,
      defaultUsername: sshSettings.defaultUsername.trim(),
      defaultPort: normalizeSshPort(sshSettings.defaultPort),
      jumpHost: sshSettings.jumpHost.trim(),
      jumpPort: normalizeSshPort(sshSettings.jumpPort),
      jumpUsername: sshSettings.jumpUsername.trim(),
    });
    saveStoredSshDefaults(normalizedSsh);
    save({
      ...draft,
      refreshIntervalSeconds: selectedRefreshInterval,
      ssh: normalizedSsh,
    });
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
      <div className="settings-actions">
        <button className="primary" onClick={saveDraft}>{t("settings.save")}</button>
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
