import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { ApiClient } from "../api";
import type { AppConfig, BackendInfo, Cluster, DesktopInfo, ErrorInfo, UpdateState } from "../types";
import { asErrorInfo, isAbortError } from "../utils/errors";
import { useAsyncActionFeedback } from "../hooks/useAsyncActionFeedback";
import { AsyncActionButton, refreshActionLabels } from "./AsyncActionButton";

export function AboutPanel({
  api,
  config,
  activeCluster,
  backendOk,
  kubectlVersion,
  t,
  onError,
}: {
  api: ApiClient | null;
  config: AppConfig | null;
  activeCluster: Cluster | null;
  backendOk: boolean;
  kubectlVersion: string;
  t: (key: string) => string;
  onError: (error: ErrorInfo) => void;
}) {
  const [desktopInfo, setDesktopInfo] = useState<DesktopInfo | null>(null);
  const [backendInfo, setBackendInfo] = useState<BackendInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const refreshFeedback = useAsyncActionFeedback();

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      try {
        const [desktop, backend] = await Promise.all([window.kubedeck.getDesktopInfo(), api ? api.appInfo(signal) : Promise.resolve(null)]);
        if (signal?.aborted) return false;
        setDesktopInfo(desktop);
        setBackendInfo(backend);
        return true;
      } catch (err) {
        if (!isAbortError(err)) onError(asErrorInfo(err));
        return false;
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [api, onError],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const diagnostics = useMemo(
    () => ({
      generatedAt: new Date().toISOString(),
      desktop: desktopInfo,
      backend: backendInfo,
      backendOk,
      kubectlVersion: kubectlVersion || null,
      activeCluster: activeCluster
        ? {
            id: activeCluster.id,
            displayName: activeCluster.displayName,
            kubeconfigPath: activeCluster.kubeconfigPath,
          }
        : null,
      clusters:
        config?.clusters.map((cluster) => ({
          id: cluster.id,
          displayName: cluster.displayName,
          kubeconfigPath: cluster.kubeconfigPath,
          lastOpened: cluster.lastOpened,
          // "Nothing is updating" is usually this, so it belongs in the report
          // a user pastes when asking why.
          connected: (config.connectedClusterIds ?? []).includes(cluster.id),
        })) ?? [],
      // Public status only: enabled, configured, model and base URL. The key is
      // not part of this shape and must never be added to it.
      llm: backendInfo?.settings.llm ?? null,
      settings: config
        ? {
            kubectlPath: config.settings.kubectlPath,
            language: config.settings.language,
            theme: config.settings.theme,
            refreshIntervalSeconds: config.settings.refreshIntervalSeconds,
            logsTailLines: config.settings.logsTailLines,
          }
        : null,
    }),
    [activeCluster, backendInfo, backendOk, config, desktopInfo, kubectlVersion],
  );

  async function copyDiagnostics() {
    await navigator.clipboard.writeText(JSON.stringify(diagnostics, null, 2));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <section className="about-panel">
      <div className="about-hero">
        <div>
          <span className="about-badge">{t("about.badge")}</span>
          <h2>{t("about.title")}</h2>
          <p>{t("about.description")}</p>
        </div>
        <div className="about-actions">
          <AsyncActionButton
            className="secondary-btn about-action-button about-refresh-button"
            phase={refreshFeedback.phase}
            labels={refreshActionLabels(t)}
            onClick={() => void refreshFeedback.run(() => load())}
            disabled={loading}
          />
          <button className="primary about-action-button about-copy-button" onClick={copyDiagnostics}>
            {copied ? t("common.copied") : t("about.copyDiagnostics")}
          </button>
        </div>
      </div>

      <div className="about-grid">
        <AboutCard title={t("about.application")}>
          <InfoRow label={t("about.name")} value={desktopInfo?.appName || "KubeDeck"} />
          <InfoRow label={t("about.version")} value={desktopInfo?.appVersion || "—"} />
          <InfoRow label={t("about.mode")} value={desktopInfo?.isPackaged ? t("about.packaged") : t("about.development")} />
          <InfoRow label={t("about.platform")} value={desktopInfo ? `${desktopInfo.platform}/${desktopInfo.arch}` : "-"} />
        </AboutCard>

        <AboutCard title={t("about.components")}>
          <InfoRow label={t("about.backend")} value={backendInfo ? `${backendInfo.backendVersion} · ${backendInfo.service}` : backendOk ? t("common.ok") : "-"} />
          <InfoRow label={t("about.kubectl")} value={kubectlVersion || "-"} />
          <InfoRow label={t("about.electron")} value={desktopInfo?.electronVersion || "-"} />
          <InfoRow label={t("about.chrome")} value={desktopInfo?.chromeVersion || "-"} />
          <InfoRow label={t("about.node")} value={desktopInfo?.nodeVersion || "-"} />
        </AboutCard>

        <UpdatesCard t={t} />

        <AboutCard title={t("about.storage")} wide>
          <PathRow label={t("about.appData")} value={backendInfo?.paths.root || desktopInfo?.paths.root} action={() => window.kubedeck.openAppFolder("root")} t={t} />
          <PathRow label={t("about.configPath")} value={backendInfo?.paths.config || desktopInfo?.paths.config} action={() => window.kubedeck.openAppFolder("config")} t={t} />
          <PathRow label={t("about.kubeconfigsPath")} value={backendInfo?.paths.kubeconfigs || desktopInfo?.paths.kubeconfigs} action={() => window.kubedeck.openAppFolder("kubeconfigs")} t={t} />
          <PathRow label={t("about.logsPath")} value={backendInfo?.paths.logs || desktopInfo?.paths.logs} action={() => window.kubedeck.openAppFolder("logs")} t={t} />
        </AboutCard>

        <AboutCard title={t("about.currentCluster")}>
          <InfoRow label={t("about.clusterName")} value={activeCluster?.displayName || "-"} />
          <InfoRow label={t("about.clusterId")} value={activeCluster?.id || "-"} mono />
          <InfoRow label={t("about.kubeconfig")} value={activeCluster?.kubeconfigPath || "-"} mono />
          <InfoRow label={t("about.clusterCount")} value={String(config?.clusters.length ?? backendInfo?.clusters ?? 0)} />
          <InfoRow label={t("about.llm")} value={llmSummary(backendInfo, t)} />
        </AboutCard>

        {/* KubeDeck is Apache-2.0 and redistributes third-party components, and
            none of that was visible anywhere in the packaged application - only
            in files in the repository, which someone running the portable exe
            does not have. */}
        <AboutCard title={t("about.licensing")} wide>
          <InfoRow label={t("about.license")} value="Apache License 2.0" />
          {/* Verbatim from NOTICE. A computed year would misstate it. */}
          <InfoRow label={t("about.copyright")} value="Copyright 2026 Maksim Pronin" />
          <InfoRow label={t("about.thirdParty")} value={t("about.thirdPartyValue")} />
        </AboutCard>
      </div>
    </section>
  );
}

// The public LLM status carries no key - that is the whole point of its shape -
// so it is safe both on screen and in the copied diagnostics, where "is the
// model even configured" is a common first question.
function llmSummary(backendInfo: BackendInfo | null, t: (key: string) => string): string {
  const llm = backendInfo?.settings.llm;
  if (!llm?.enabled || !llm.configured) return t("about.llmOff");
  return llm.model ? `${llm.model} · ${llm.baseUrl}` : llm.baseUrl;
}

// Updates ask, download and install nothing on their own: a release is a couple
// of hundred megabytes and the person in front of the screen may be on a
// tethered phone in a datacentre. What the card can offer depends on how this
// copy was installed - see `canInstall` in src/shared/updateState.ts - and the
// builds that cannot replace themselves are sent to the release page rather
// than told nothing.
function UpdatesCard({ t }: { t: (key: string) => string }) {
  const [update, setUpdate] = useState<UpdateState | null>(null);

  useEffect(() => {
    let active = true;
    window.kubedeck
      .getUpdateState()
      .then((state) => {
        if (active) setUpdate(state);
      })
      .catch(() => undefined);
    // Progress arrives on its own; the disposer keeps a listener from being
    // left behind every time this section is closed and opened again.
    const dispose = window.kubedeck.onUpdateState((state) => {
      if (active) setUpdate(state);
    });
    return () => {
      active = false;
      dispose();
    };
  }, []);

  const busy = update?.status === "checking" || update?.status === "downloading";
  const reason = update && !update.canInstall ? translateUpdateReason(update.message, t) : "";

  return (
    <AboutCard title={t("about.updates")} wide>
      <InfoRow label={t("about.updateStatus")} value={updateStatusText(update, t)} />
      {reason ? <InfoRow label={t("about.updateInstallable")} value={reason} /> : null}
      <div className="about-row about-update-row">
        <dt>{t("about.updateActions")}</dt>
        <dd className="about-update-actions">
          <button className="secondary-btn" onClick={() => void window.kubedeck.checkForUpdates()} disabled={busy}>
            {t("about.updateCheck")}
          </button>
          {update?.status === "available" && update.canInstall ? (
            <button className="primary" onClick={() => void window.kubedeck.downloadUpdate()}>
              {t("about.updateDownload")}
            </button>
          ) : null}
          {update?.status === "downloaded" ? (
            <button className="primary" onClick={() => void window.kubedeck.installUpdate()}>
              {t("about.updateInstall")}
            </button>
          ) : null}
          <button className="secondary-btn" onClick={() => void window.kubedeck.openReleases()}>
            {t("about.updateReleases")}
          </button>
        </dd>
      </div>
    </AboutCard>
  );
}

function updateStatusText(update: UpdateState | null, t: (key: string) => string): string {
  if (!update) return "-";
  if (update.status === "checking") return t("about.updateChecking");
  if (update.status === "current") return `${t("about.updateCurrent")} (${update.currentVersion})`;
  if (update.status === "available") return `${t("about.updateAvailable")} ${update.availableVersion}`;
  if (update.status === "downloading") return `${t("about.updateDownloading")} ${update.percent}%`;
  if (update.status === "downloaded") return `${t("about.updateReady")} ${update.availableVersion}`;
  if (update.status === "unsupported") return translateUpdateReason(update.message, t);
  if (update.status === "error") return `${t("about.updateFailed")}: ${update.message}`;
  return t("about.updateIdle");
}

// The main process cannot translate: it has no catalogue and no idea which
// language is selected. It sends a key for the reasons it knows in advance and
// plain text for whatever the updater itself reported, and this tells the two
// apart rather than printing "about.update.reason.portable" at a user.
function translateUpdateReason(message: string, t: (key: string) => string): string {
  if (!message) return "";
  return message.startsWith("about.update.reason.") ? t(message) : message;
}

function AboutCard({ title, wide, children }: { title: string; wide?: boolean; children: ReactNode }) {
  return (
    <article className={wide ? "about-card wide" : "about-card"}>
      <h3>{title}</h3>
      {children}
    </article>
  );
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="about-row">
      <dt>{label}</dt>
      <dd className={mono ? "mono" : undefined} title={value}>
        {value}
      </dd>
    </div>
  );
}

function PathRow({ label, value, action, t }: { label: string; value?: string; action: () => void; t: (key: string) => string }) {
  return (
    <div className="about-row path-row">
      <dt>{label}</dt>
      <dd className="mono" title={value || "-"}>
        {value || "-"}
      </dd>
      <button className="secondary-btn" onClick={action} disabled={!value}>
        {t("about.open")}
      </button>
    </div>
  );
}
