import { useEffect, useState } from "react";
import type { ApiClient } from "../api";
import type { Cluster, ErrorInfo, Settings } from "../types";
import { normalizeRefreshIntervalSeconds, REFRESH_INTERVAL_OPTIONS_SECONDS } from "../utils/refresh";
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
  const [draft, setDraft] = useState(settings);
  useEffect(() => setDraft(settings), [settings]);
  const selectedRefreshInterval = normalizeRefreshIntervalSeconds(draft.refreshIntervalSeconds);
  const saveDraft = () => save({ ...draft, refreshIntervalSeconds: selectedRefreshInterval });
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
