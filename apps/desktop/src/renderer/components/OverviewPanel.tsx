import { formatBytes, formatCpuMillicores } from "../../shared/formatQuantity";
import { AlertTriangle, ArrowRight, CheckCircle2, Clock3, Gauge, RefreshCw, Server, ShieldAlert } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { ApiClient } from "../api";
import type { Cluster, ClusterOverviewResponse, ErrorInfo, Settings } from "../types";
import type { ResourceWorkspaceTab } from "../utils/workspaceTabs";
import { asErrorInfo, isAbortError } from "../utils/errors";
import { getAutoRefreshIntervalSeconds, shouldSkipSilentRefresh } from "../utils/refresh";
import { formatElapsed } from "../utils/time";
import { ThemedSelect } from "./ThemedSelect";

type CapacityAmount = {
  used?: number;
  available?: number;
  allocatable?: number;
  measuredNodes: number;
};

export function OverviewPanel({
  api,
  cluster,
  namespaces,
  settings,
  recentTabs,
  terminalCount,
  onError,
  onNavigate,
  onOpenTab,
  t,
}: {
  api: ApiClient | null;
  cluster: Cluster | null;
  namespaces: string[];
  settings: Settings | undefined;
  recentTabs: ResourceWorkspaceTab[];
  terminalCount: number;
  onError: (error: ErrorInfo | null) => void;
  onNavigate: (resource: string) => void;
  onOpenTab: (tab: ResourceWorkspaceTab) => void;
  t: (key: string) => string;
}) {
  const [data, setData] = useState<ClusterOverviewResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [stale, setStale] = useState(false);
  const [capacityViewKey, setCapacityViewKey] = useState("role");
  const requestRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setCapacityViewKey(loadCapacityViewKey(cluster?.id));
  }, [cluster?.id]);

  const refresh = useCallback(
    async (silent = false) => {
      if (!api || !cluster) return false;
      if (shouldSkipSilentRefresh(silent, requestRef.current !== null)) return false;
      requestRef.current?.abort();
      const controller = new AbortController();
      requestRef.current = controller;
      if (!silent) setLoading(true);
      try {
        const response = await api.overview(cluster.id, namespaces, controller.signal);
        setData(response);
        setStale(false);
        onError(null);
        return true;
      } catch (error) {
        if (isAbortError(error)) return false;
        setStale(Boolean(data));
        onError(asErrorInfo(error));
        return false;
      } finally {
        if (requestRef.current === controller) {
          requestRef.current = null;
          if (!silent) setLoading(false);
        }
      }
    },
    [api, cluster?.id, namespaces.join(","), onError, data],
  );

  useEffect(() => {
    void refresh();
    return () => requestRef.current?.abort();
  }, [api, cluster?.id, namespaces.join(",")]);

  // Unlike the resource table, this panel keeps polling even when watches are
  // healthy - and deliberately so: a watch is opened for the one resource the
  // table shows, and while this panel is the active section there is no watch
  // open at all. There is nothing here for `shouldPollResources` to consult.
  useEffect(() => {
    const seconds = getAutoRefreshIntervalSeconds(settings);
    if (!api || !cluster || seconds <= 0) return;
    const timer = window.setInterval(() => void refresh(true), seconds * 1000);
    return () => window.clearInterval(timer);
  }, [api, cluster?.id, namespaces.join(","), settings?.refreshIntervalSeconds, refresh]);

  if (!cluster) {
    return (
      <section className="overview-empty">
        <Gauge size={34} />
        <h2>{t("overview.selectCluster")}</h2>
        <p>{t("overview.selectClusterText")}</p>
      </section>
    );
  }

  if (!data && loading) return <OverviewSkeleton />;
  if (!data)
    return (
      <section className="overview-empty">
        <AlertTriangle size={34} />
        <h2>{t("overview.unavailable")}</h2>
        <button className="icon-text" onClick={() => void refresh()}>
          {t("common.retry")}
        </button>
      </section>
    );

  const title = t(`overview.verdict.${data.verdict.tone}`);
  const now = Date.now();
  const capacityView = data.capacity.views.find((view) => view.key === capacityViewKey) ?? data.capacity.views[0];
  return (
    <section className="overview-panel" aria-busy={loading}>
      <header className={`overview-pulse is-${data.verdict.tone}`}>
        <div className="overview-pulse-title">
          {data.verdict.tone === "success" ? <CheckCircle2 size={22} /> : data.verdict.tone === "danger" ? <ShieldAlert size={22} /> : <Clock3 size={22} />}
          <div>
            <span>{t("overview.clusterPulse")}</span>
            <h2>{title}</h2>
          </div>
        </div>
        <div className="overview-context">
          <span>{cluster.displayName}</span>
          <span>{namespaces.includes("all") ? t("overview.allNamespaces") : namespaces.join(", ")}</span>
          <span title={data.generatedAt}>{stale ? t("overview.stale") : formatElapsed(Math.max(0, now - Date.parse(data.generatedAt)))}</span>
          <button className="icon-button overview-refresh" onClick={() => void refresh()} disabled={loading} aria-label={t("resources.refresh")} title={t("resources.refresh")}>
            <RefreshCw size={14} className={loading ? "spin" : ""} />
          </button>
        </div>
        <div className="overview-kpis">
          <Kpi label={t("overview.nodes")} value={`${data.summary.nodesReady}/${data.summary.nodesTotal}`} tone={data.summary.nodesReady === data.summary.nodesTotal ? "success" : "danger"} />
          <Kpi label={t("overview.workloads")} value={`${data.summary.workloadsHealthy}/${data.summary.workloadsTotal}`} />
          <Kpi label={t("overview.pods")} value={`${data.summary.podsReady}/${data.summary.podsTotal}`} />
          <Kpi label={t("overview.namespaces")} value={String(data.clusterProfile.namespaces)} />
        </div>
      </header>

      {data.errors.length ? (
        <div className="overview-partial">
          <AlertTriangle size={14} /> {t("overview.partial")} ({data.errors.length})
        </div>
      ) : null}

      <div className="overview-grid">
        <OverviewCard title={t("overview.capacity")} onAction={() => onNavigate("nodes")} action={t("overview.openNodes")} wide>
          {data.capacity.views.length > 1 ? (
            <div className="overview-capacity-toolbar">
              <span>{t("overview.capacityGroupBy")}</span>
              <ThemedSelect
                value={capacityView?.key ?? "role"}
                options={data.capacity.views.map((view) => ({
                  value: view.key,
                  label: view.key === "role" ? t("overview.capacityNodeRole") : view.label,
                  description: view.key.startsWith("label:") && view.key.slice(6) !== view.label ? view.key.slice(6) : undefined,
                }))}
                ariaLabel={t("overview.capacityGroupBy")}
                onChange={(key) => {
                  setCapacityViewKey(key);
                  saveCapacityViewKey(cluster.id, key);
                }}
              />
            </div>
          ) : null}
          {capacityView?.groups.length ? (
            <div className="overview-capacity-groups">
              {capacityView.groups.map((group) => (
                <section className="overview-capacity-group" key={group.id}>
                  <header>
                    <strong>{capacityGroupName(group.name, t)}</strong>
                    <span>
                      {group.readyNodes}/{group.nodes} {t("overview.capacityNodes")}
                    </span>
                  </header>
                  <CapacityRings
                    metrics={[
                      { id: "cpu", label: "CPU", amount: group.cpu, format: formatCpuCapacity, totalLabel: t("overview.capacityAllocatable") },
                      { id: "memory", label: "RAM", amount: group.memory, format: formatMemoryCapacity, totalLabel: t("overview.capacityAllocatable") },
                      { id: "storage", label: "Storage", amount: group.storage, format: formatMemoryCapacity, totalLabel: t("overview.capacityTotal") },
                    ]}
                    usedLabel={t("overview.capacityUsed")}
                    availableLabel={t("overview.capacityAvailable")}
                  />
                  {Math.min(group.cpu.measuredNodes, group.memory.measuredNodes, group.storage.measuredNodes) < group.nodes ? (
                    <p>
                      {t("overview.capacityMetrics")} {Math.min(group.cpu.measuredNodes, group.memory.measuredNodes, group.storage.measuredNodes)}/{group.nodes}
                    </p>
                  ) : group.pressuredNodes ? (
                    <p className="is-danger">
                      {group.pressuredNodes} {t("overview.pressuredNodes")}
                    </p>
                  ) : null}
                </section>
              ))}
            </div>
          ) : (
            <div className="overview-capacity-empty">{t("overview.capacityNoWorkers")}</div>
          )}
          <CapacityExclusions excluded={data.capacity.excluded} t={t} />
        </OverviewCard>

        <OverviewCard title={t("overview.clusterProfile")}>
          <div className="overview-profile">
            <ProfileFact label={t("overview.kubernetes")} values={data.clusterProfile.kubernetesVersions} />
            <ProfileFact label={t("overview.operatingSystems")} values={data.clusterProfile.operatingSystems} />
            <ProfileFact label={t("overview.architectures")} values={data.clusterProfile.architectures} />
            <ProfileFact label={t("overview.containerRuntimes")} values={data.clusterProfile.containerRuntimes} />
            <ProfileFact label={t("overview.schedulingDisabled")} values={[String(data.clusterProfile.schedulingDisabled)]} />
          </div>
        </OverviewCard>

        <OverviewCard title={t("overview.workloadHealth")} wide>
          <div className="overview-workloads">
            {data.workloads
              .filter((item) => item.total > 0)
              .map((item) => (
                <button key={item.resource} onClick={() => onNavigate(item.resource)}>
                  <strong>{item.resource}</strong>
                  <span className="is-success">{item.healthy}</span>
                  <span className="is-pending">{item.pending}</span>
                  <span className="is-danger">{item.danger}</span>
                </button>
              ))}
          </div>
        </OverviewCard>

        <OverviewCard title={t("overview.continue")}>
          <div className="overview-list compact">
            {recentTabs
              .slice(-4)
              .reverse()
              .map((tab) => (
                <button key={tab.id} className="overview-list-row" onClick={() => onOpenTab(tab)}>
                  <strong>{tab.row.name}</strong>
                  <span>
                    {tab.resource} · {tab.namespace}
                  </span>
                  <ArrowRight size={14} />
                </button>
              ))}
            {!recentTabs.length ? <QuickAccess onNavigate={onNavigate} /> : null}
          </div>
          {terminalCount ? (
            <p className="overview-card-note">
              {terminalCount} {t("overview.terminals")}
            </p>
          ) : null}
        </OverviewCard>
      </div>
    </section>
  );
}

function OverviewSkeleton() {
  return (
    <section className="overview-panel overview-skeleton" aria-label="Loading overview">
      <div />
      <div className="overview-grid">
        <div />
        <div />
        <div />
        <div />
      </div>
    </section>
  );
}

function OverviewCard({ title, action, onAction, wide, children }: { title: string; action?: string; onAction?: () => void; wide?: boolean; children: ReactNode }) {
  return (
    <article className={`overview-card ${wide ? "wide" : ""}`}>
      <header>
        <h3>{title}</h3>
        {action ? (
          <button onClick={onAction}>
            {action}
            <ArrowRight size={13} />
          </button>
        ) : null}
      </header>
      {children}
    </article>
  );
}

function Kpi({ label, value, tone = "neutral" }: { label: string; value: string; tone?: string }) {
  return (
    <div className={`overview-kpi is-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function CapacityRings({
  metrics,
  usedLabel,
  availableLabel,
}: {
  metrics: Array<{ id: string; label: string; amount: CapacityAmount; format: (value?: number) => string; totalLabel: string }>;
  usedLabel: string;
  availableLabel: string;
}) {
  const radii = [36, 54, 72];
  return (
    <div className="overview-capacity-visual">
      <svg className="overview-capacity-rings" viewBox="0 0 180 180" role="img" aria-label={metrics.map((metric) => `${metric.label}: ${metric.format(metric.amount.used)} ${usedLabel}`).join(", ")}>
        {metrics.map((metric, index) => {
          const fill = capacityFill(metric.amount);
          return (
            <g className={`is-${metric.id}`} key={metric.id}>
              <circle className="overview-capacity-ring-track" cx="90" cy="90" r={radii[index]} pathLength="100" />
              <circle className="overview-capacity-ring-value" cx="90" cy="90" r={radii[index]} pathLength="100" strokeDasharray={`${fill} 100`} />
            </g>
          );
        })}
        <text x="90" y="86">
          CPU
        </text>
        <text className="overview-capacity-ring-center-value" x="90" y="102">
          {metrics[0].format(metrics[0].amount.used)}
        </text>
      </svg>
      <div className="overview-capacity-legend">
        {metrics.map((metric) => (
          <section className={`is-${metric.id}`} key={metric.id}>
            <header>
              <i />
              <strong>{metric.label}</strong>
              <span>
                {metric.format(metric.amount.used)} {usedLabel}
              </span>
            </header>
            <dl>
              <div>
                <dt>{availableLabel}</dt>
                <dd>{metric.format(metric.amount.available)}</dd>
              </div>
              <div>
                <dt>{metric.totalLabel}</dt>
                <dd>{metric.format(metric.amount.allocatable)}</dd>
              </div>
            </dl>
          </section>
        ))}
      </div>
    </div>
  );
}

function capacityFill(amount: CapacityAmount): number {
  return amount.used === undefined || !amount.allocatable ? 0 : Math.min(100, Math.max(0, (amount.used / amount.allocatable) * 100));
}

function CapacityExclusions({ excluded, t }: { excluded: ClusterOverviewResponse["capacity"]["excluded"]; t: (key: string) => string }) {
  const values = [excluded.controlPlane ? `control-plane ${excluded.controlPlane}` : "", excluded.etcd ? `etcd ${excluded.etcd}` : "", excluded.ingress ? `ingress ${excluded.ingress}` : ""].filter(
    Boolean,
  );
  return values.length ? (
    <p className="overview-capacity-excluded">
      {t("overview.capacitySeparated")}: {values.join(" · ")}
    </p>
  ) : null;
}

function capacityGroupName(name: string, t: (key: string) => string): string {
  if (name === "workers") return t("overview.capacityWorkers");
  if (name === "unlabelled") return t("overview.capacityUnlabelled");
  if (name === "control-plane") return t("overview.capacityControlPlane");
  if (name === "ingress") return t("overview.capacityIngress");
  if (name === "etcd") return "etcd";
  return name;
}

// Grouping is on here and nowhere else: a cluster total can run into thousands
// of cores, and this string is read, not parsed.
const formatCpuCapacity = (value?: number): string => formatCpuMillicores(value, { group: true, fallback: "N/A" });

const formatMemoryCapacity = (value?: number): string => formatBytes(value, { group: true, fallback: "N/A" });

function loadCapacityViewKey(clusterId?: string): string {
  if (!clusterId) return "role";
  try {
    return window.localStorage.getItem(`kubedeck.overview.capacity.${clusterId}`) || "role";
  } catch {
    return "role";
  }
}

function saveCapacityViewKey(clusterId: string, key: string): void {
  try {
    window.localStorage.setItem(`kubedeck.overview.capacity.${clusterId}`, key);
  } catch {
    // View preferences are optional.
  }
}

function QuickAccess({ onNavigate }: { onNavigate: (resource: string) => void }) {
  return (
    <div className="overview-quick">
      {["pods", "deployments", "nodes", "namespaces"].map((resource) => (
        <button key={resource} onClick={() => onNavigate(resource)}>
          <Server size={13} />
          {resource}
        </button>
      ))}
    </div>
  );
}

function ProfileFact({ label, values }: { label: string; values: string[] }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{values.length ? values.join(", ") : "—"}</strong>
    </div>
  );
}
