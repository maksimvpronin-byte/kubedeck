import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { ApiClient } from "../api";
import type { AppConfig, BackendInfo, Cluster, DesktopInfo, ErrorInfo } from "../types";
import { asErrorInfo, isAbortError } from "../utils/errors";

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

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const [desktop, backend] = await Promise.all([
        window.kubedeck.getDesktopInfo(),
        api ? api.appInfo(signal) : Promise.resolve(null),
      ]);
      if (signal?.aborted) return;
      setDesktopInfo(desktop);
      setBackendInfo(backend);
    } catch (err) {
      if (!isAbortError(err)) onError(asErrorInfo(err));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [api, onError]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const diagnostics = useMemo(() => ({
    generatedAt: new Date().toISOString(),
    desktop: desktopInfo,
    backend: backendInfo,
    backendOk,
    kubectlVersion: kubectlVersion || null,
    activeCluster: activeCluster ? {
      id: activeCluster.id,
      displayName: activeCluster.displayName,
      kubeconfigPath: activeCluster.kubeconfigPath,
    } : null,
    clusters: config?.clusters.map((cluster) => ({
      id: cluster.id,
      displayName: cluster.displayName,
      kubeconfigPath: cluster.kubeconfigPath,
      lastOpened: cluster.lastOpened,
    })) ?? [],
    settings: config ? {
      kubectlPath: config.settings.kubectlPath,
      language: config.settings.language,
      theme: config.settings.theme,
      refreshIntervalSeconds: config.settings.refreshIntervalSeconds,
      logsTailLines: config.settings.logsTailLines,
    } : null,
  }), [activeCluster, backendInfo, backendOk, config, desktopInfo, kubectlVersion]);

  async function copyDiagnostics() {
    await navigator.clipboard.writeText(JSON.stringify(diagnostics, null, 2));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <section className="about-panel">
      <div className="about-hero">
        <div>
          <span>{t("about.badge")}</span>
          <h2>{t("about.title")}</h2>
          <p>{t("about.description")}</p>
        </div>
        <div className="about-actions">
          <button onClick={() => load()} disabled={loading}>{loading ? t("common.loading") : t("common.refresh")}</button>
          <button className="primary" onClick={copyDiagnostics}>{copied ? t("common.copied") : t("about.copyDiagnostics")}</button>
        </div>
      </div>

      <div className="about-grid">
        <AboutCard title={t("about.application")}>
          <InfoRow label={t("about.name")} value={desktopInfo?.appName || "KubeDeck"} />
          <InfoRow label={t("about.version")} value={desktopInfo?.appVersion || "1.1.0"} />
          <InfoRow label={t("about.mode")} value={desktopInfo?.isPackaged ? t("about.packaged") : t("about.development")} />
          <InfoRow label={t("about.platform")} value={desktopInfo ? `${desktopInfo.platform}/${desktopInfo.arch}` : "-"} />
        </AboutCard>

        <AboutCard title={t("about.components")}>
          <InfoRow label={t("about.backend")} value={backendInfo ? `${backendInfo.backendVersion} · ${backendInfo.service}` : (backendOk ? t("common.ok") : "-")} />
          <InfoRow label={t("about.python")} value={backendInfo?.pythonVersion || "-"} />
          <InfoRow label={t("about.kubectl")} value={kubectlVersion || "-"} />
          <InfoRow label={t("about.electron")} value={desktopInfo?.electronVersion || "-"} />
          <InfoRow label={t("about.chrome")} value={desktopInfo?.chromeVersion || "-"} />
          <InfoRow label={t("about.node")} value={desktopInfo?.nodeVersion || "-"} />
        </AboutCard>

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
        </AboutCard>

        <AboutCard title={t("about.releaseChecklist")} wide>
          <ul className="about-checklist">
            <li>{t("about.checklist.typecheck")}</li>
            <li>{t("about.checklist.build")}</li>
            <li>{t("about.checklist.package")}</li>
            <li>{t("about.checklist.smoke")}</li>
          </ul>
          <code>npm.cmd run typecheck</code>
          <code>npm.cmd run build</code>
          <code>npm.cmd run package:win</code>
        </AboutCard>
      </div>
    </section>
  );
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
      <dd className={mono ? "mono" : undefined} title={value}>{value}</dd>
    </div>
  );
}

function PathRow({ label, value, action, t }: { label: string; value?: string; action: () => void; t: (key: string) => string }) {
  return (
    <div className="about-row path-row">
      <dt>{label}</dt>
      <dd className="mono" title={value || "-"}>{value || "-"}</dd>
      <button onClick={action} disabled={!value}>{t("about.open")}</button>
    </div>
  );
}
