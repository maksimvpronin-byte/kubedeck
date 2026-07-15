import { useEffect, useMemo, useRef, useState } from "react";
import type { ApiClient } from "../api";
import type { Cluster, ErrorInfo, ProblemsSummary, ResourceRow, Settings } from "../types";
import { asErrorInfo, isAbortError } from "../utils/errors";
import { getAutoRefreshIntervalSeconds } from "../utils/refresh";
import { ErrorPanel } from "./ErrorPanel";
import { ResourceTable } from "./ResourceTable";
import { refreshActionLabels } from "./AsyncActionButton";

type SeverityFilter = "all" | "critical" | "warning" | "info";

type ProblemCategory = "crashLoop" | "imagePull" | "scheduling" | "node" | "storage" | "restarts" | "probe" | "deployment" | "event" | "podPhase" | "generic";

export function ProblemsPanel({
  api,
  cluster,
  settings,
  copyLabel,
  t,
  onError,
  onOpenResource,
}: {
  api: ApiClient | null;
  cluster: Cluster | null;
  settings: Settings | undefined;
  copyLabel: string;
  t: (key: string) => string;
  onError: (error: ErrorInfo | null) => void;
  onOpenResource: (row: ResourceRow) => void;
}) {
  const [problems, setProblems] = useState<ResourceRow[]>([]);
  const [summary, setSummary] = useState<ProblemsSummary | null>(null);
  const [partialErrors, setPartialErrors] = useState<Array<ErrorInfo & { resource?: string; namespace?: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [localError, setLocalError] = useState<ErrorInfo | null>(null);
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("all");
  const [namespaceFilter, setNamespaceFilter] = useState("all");
  const [kindFilter, setKindFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [copiedProblemId, setCopiedProblemId] = useState<string | null>(null);
  const requestRef = useRef<AbortController | null>(null);

  async function refreshProblems(silent = false) {
    if (!api || !cluster) return false;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    if (!silent) setLoading(true);
    setLocalError(null);
    try {
      const response = await api.problems(cluster.id, controller.signal);
      setProblems(response.items);
      setSummary(response.summary);
      setPartialErrors(response.errors ?? []);
      onError(null);
      return true;
    } catch (err) {
      if (isAbortError(err)) return false;
      const info = asErrorInfo(err);
      setLocalError(info);
      onError(info);
      return false;
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
        if (!silent) setLoading(false);
      }
    }
  }

  function openProblem(row: ResourceRow) {
    onOpenResource(problemOpenLocator(row));
  }

  function copyProblem(row: ResourceRow) {
    const text = problemDiagnosticText(row, cluster, t);
    if (!navigator.clipboard) return;
    const key = rowKey(row);
    void navigator.clipboard.writeText(text).then(() => {
      setCopiedProblemId(key);
      window.setTimeout(() => {
        setCopiedProblemId((current) => (current === key ? null : current));
      }, 1800);
    });
  }

  useEffect(() => {
    refreshProblems();
    return () => requestRef.current?.abort();
  }, [api, cluster?.id]);

  useEffect(() => {
    if (!api || !cluster) return;
    const intervalSeconds = getAutoRefreshIntervalSeconds(settings);
    if (intervalSeconds <= 0) return;
    const timer = window.setInterval(() => refreshProblems(true), intervalSeconds * 1000);
    return () => window.clearInterval(timer);
  }, [api, cluster?.id, settings?.refreshIntervalSeconds]);

  const enhancedProblems = useMemo<ResourceRow[]>(() => {
    return problems.map((problem) => {
      const category = problemCategory(problem);
      const advice = problemAdvice(problem, t);
      return {
        ...problem,
        category,
        categoryLabel: categoryLabel(category, t),
        diagnosis: advice.summary,
        nextCheck: advice.nextCheck,
      } as ResourceRow;
    });
  }, [problems, t]);

  const namespaces = useMemo(() => uniqueSorted(enhancedProblems.map((item) => readString(item, "namespace")).filter(Boolean)), [enhancedProblems]);
  const kinds = useMemo(() => uniqueSorted(enhancedProblems.map((item) => readString(item, "kind")).filter(Boolean)), [enhancedProblems]);
  const categories = useMemo(() => uniqueSorted(enhancedProblems.map((item) => readString(item, "category")).filter(Boolean)), [enhancedProblems]);

  useEffect(() => {
    if (namespaceFilter === "all" || namespaces.includes(namespaceFilter)) return;
    setNamespaceFilter("all");
  }, [namespaceFilter, namespaces]);

  useEffect(() => {
    if (kindFilter === "all" || kinds.includes(kindFilter)) return;
    setKindFilter("all");
  }, [kindFilter, kinds]);

  useEffect(() => {
    if (categoryFilter === "all" || categories.includes(categoryFilter)) return;
    setCategoryFilter("all");
  }, [categoryFilter, categories]);

  const filteredProblems = useMemo(() => {
    return enhancedProblems.filter((problem) => {
      const severity = readString(problem, "severity", "info").toLowerCase();
      const namespace = readString(problem, "namespace");
      const kind = readString(problem, "kind");
      const category = readString(problem, "category");
      if (severityFilter !== "all" && severity !== severityFilter) return false;
      if (namespaceFilter !== "all" && namespace !== namespaceFilter) return false;
      if (kindFilter !== "all" && kind !== kindFilter) return false;
      if (categoryFilter !== "all" && category !== categoryFilter) return false;
      return true;
    });
  }, [enhancedProblems, severityFilter, namespaceFilter, kindFilter, categoryFilter]);

  const guidance = useMemo(() => summarizeGuidance(filteredProblems, t), [filteredProblems, t]);
  const priorityProblems = useMemo(() => filteredProblems.slice(0, 5), [filteredProblems]);

  if (!cluster) {
    return (
      <section className="placeholder-page">
        <h2>{t("nav.problems")}</h2>
        <p>{t("problems.openCluster")}</p>
      </section>
    );
  }

  return (
    <>
      <ErrorPanel error={localError} copyLabel={copyLabel} />
      <ProblemsSummaryBar summary={summary} loading={loading} visibleCount={filteredProblems.length} t={t} />
      <ProblemsControls
        severityFilter={severityFilter}
        namespaceFilter={namespaceFilter}
        kindFilter={kindFilter}
        categoryFilter={categoryFilter}
        namespaces={namespaces}
        kinds={kinds}
        categories={categories}
        onSeverityChange={setSeverityFilter}
        onNamespaceChange={setNamespaceFilter}
        onKindChange={setKindFilter}
        onCategoryChange={setCategoryFilter}
        onReset={() => {
          setSeverityFilter("all");
          setNamespaceFilter("all");
          setKindFilter("all");
          setCategoryFilter("all");
        }}
        t={t}
      />
      {priorityProblems.length ? <PriorityProblems items={priorityProblems} copiedProblemId={copiedProblemId} onOpen={openProblem} onCopy={copyProblem} t={t} /> : null}
      {guidance.length ? <ProblemsGuidance items={guidance} t={t} /> : <ProblemsEmptyState loading={loading} total={problems.length} t={t} />}
      {partialErrors.length ? (
        <section className="problem-partial-warning">
          <strong>{t("problems.partial")}</strong>
          <span>
            {partialErrors.length} {t("problems.partialText")}
          </span>
          {partialErrors.slice(0, 3).map((item) => (
            <code key={`${item.resource ?? "unknown"}-${item.code}`}>
              {item.resource ?? "unknown"}: {item.code} - {item.message}
            </code>
          ))}
        </section>
      ) : null}
      <ResourceTable
        title={t("nav.problems")}
        rows={filteredProblems}
        columns={[
          { key: "severity", label: t("col.severity") },
          { key: "categoryLabel", label: t("problems.category") },
          { key: "kind", label: t("col.kind") },
          { key: "namespace", label: t("col.namespace") },
          { key: "name", label: t("col.name") },
          { key: "reason", label: t("col.reason") },
          { key: "diagnosis", label: t("problems.diagnosis") },
          { key: "nextCheck", label: t("problems.nextCheck") },
          { key: "createdAt", label: t("col.age") },
        ]}
        loading={loading}
        onRefresh={refreshProblems}
        onOpen={openProblem}
        filterLabel={t("resources.filter")}
        refreshLabel={t("resources.refresh")}
        refreshActionLabels={refreshActionLabels(t)}
        labels={{
          shownOf: t("resources.shownOf"),
          page: t("resources.page"),
          deleteSelected: t("resources.deleteSelected"),
          rows: t("resources.rows"),
          of: t("resources.of"),
          pageSize: t("resources.pageSize"),
          first: t("pagination.first"),
          prev: t("pagination.prev"),
          next: t("pagination.next"),
          last: t("pagination.last"),
        }}
        stateKey="problems"
      />
    </>
  );
}

function ProblemsSummaryBar({ summary, loading, visibleCount, t }: { summary: ProblemsSummary | null; loading: boolean; visibleCount: number; t: (key: string) => string }) {
  const categorySummary = summary?.categories
    ? Object.entries(summary.categories)
        .slice(0, 5)
        .map(([name, count]) => `${categoryLabel(name, t)}: ${count}`)
        .join(" · ")
    : "";
  const cards = [
    { label: t("problems.total"), value: summary?.total ?? 0, className: "" },
    { label: t("problems.visible"), value: visibleCount, className: "" },
    { label: t("problems.critical"), value: summary?.critical ?? 0, className: "critical" },
    { label: t("problems.warning"), value: summary?.warning ?? 0, className: "warning" },
    { label: t("problems.collectionErrors"), value: summary?.errors ?? 0, className: summary?.errors ? "warning" : "" },
  ];
  return (
    <section className="problem-summary-grid" aria-busy={loading}>
      {cards.map((card) => (
        <article className={`problem-summary-card ${card.className}`} key={card.label}>
          <span>{card.label}</span>
          <strong>{loading && !summary ? "..." : card.value}</strong>
        </article>
      ))}
      {summary ? (
        <>
          <article className="problem-summary-card wide">
            <span>{t("problems.sources")}</span>
            <strong>
              {Object.entries(summary.sources)
                .map(([name, count]) => `${name}: ${count}`)
                .join(" · ")}
            </strong>
          </article>
          {categorySummary ? (
            <article className="problem-summary-card wide">
              <span>{t("problems.categories")}</span>
              <strong>{categorySummary}</strong>
            </article>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function ProblemsControls({
  severityFilter,
  namespaceFilter,
  kindFilter,
  categoryFilter,
  namespaces,
  kinds,
  categories,
  onSeverityChange,
  onNamespaceChange,
  onKindChange,
  onCategoryChange,
  onReset,
  t,
}: {
  severityFilter: SeverityFilter;
  namespaceFilter: string;
  kindFilter: string;
  categoryFilter: string;
  namespaces: string[];
  kinds: string[];
  categories: string[];
  onSeverityChange: (value: SeverityFilter) => void;
  onNamespaceChange: (value: string) => void;
  onKindChange: (value: string) => void;
  onCategoryChange: (value: string) => void;
  onReset: () => void;
  t: (key: string) => string;
}) {
  const severityOptions: SeverityFilter[] = ["all", "critical", "warning", "info"];
  return (
    <section className="problems-controls">
      <div className="segmented-control" aria-label={t("problems.filterSeverity")}>
        {severityOptions.map((option) => (
          <button type="button" key={option} className={severityFilter === option ? "active" : ""} onClick={() => onSeverityChange(option)}>
            {t(`problems.severity.${option}`)}
          </button>
        ))}
      </div>
      <label>
        <span>{t("problems.filterNamespace")}</span>
        <select value={namespaceFilter} onChange={(event) => onNamespaceChange(event.target.value)}>
          <option value="all">{t("problems.allNamespaces")}</option>
          {namespaces.map((namespace) => (
            <option key={namespace} value={namespace}>
              {namespace}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>{t("problems.filterKind")}</span>
        <select value={kindFilter} onChange={(event) => onKindChange(event.target.value)}>
          <option value="all">{t("problems.allKinds")}</option>
          {kinds.map((kind) => (
            <option key={kind} value={kind}>
              {kind}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>{t("problems.filterCategory")}</span>
        <select value={categoryFilter} onChange={(event) => onCategoryChange(event.target.value)}>
          <option value="all">{t("problems.allCategories")}</option>
          {categories.map((category) => (
            <option key={category} value={category}>
              {categoryLabel(category, t)}
            </option>
          ))}
        </select>
      </label>
      <button type="button" onClick={onReset}>
        {t("problems.resetFilters")}
      </button>
    </section>
  );
}

function PriorityProblems({
  items,
  copiedProblemId,
  onOpen,
  onCopy,
  t,
}: {
  items: ResourceRow[];
  copiedProblemId: string | null;
  onOpen: (row: ResourceRow) => void;
  onCopy: (row: ResourceRow) => void;
  t: (key: string) => string;
}) {
  return (
    <section className="problems-priority">
      <header>
        <div>
          <h3>{t("problems.priorityTitle")}</h3>
          <span>{t("problems.priorityHint")}</span>
        </div>
      </header>
      <div className="problems-priority-list">
        {items.map((row) => {
          const key = rowKey(row);
          const category = problemCategory(row);
          const target = problemTargetLabel(row);
          return (
            <article key={key} className={`problem-priority-card ${normalizeSeverity(readString(row, "severity", "info"))}`}>
              <div className="problem-priority-main">
                <span className="problem-priority-meta">
                  {readString(row, "severity", "Info")} · {categoryLabel(category, t)}
                </span>
                <strong>{target}</strong>
                <p>
                  {readString(row, "reason")}: {readString(row, "message")}
                </p>
                <small>
                  {t("problems.nextCheck")}: {readString(row, "nextCheck")}
                </small>
              </div>
              <div className="problem-priority-actions">
                <button type="button" onClick={() => onOpen(row)}>
                  {t("problems.openResource")}
                </button>
                <button type="button" onClick={() => onCopy(row)}>
                  {copiedProblemId === key ? t("problems.copied") : t("problems.copyDiagnostics")}
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function ProblemsGuidance({ items, t }: { items: GuidanceItem[]; t: (key: string) => string }) {
  return (
    <section className="problems-guidance">
      <header>
        <h3>{t("problems.whatToCheck")}</h3>
        <span>{t("problems.openHint")}</span>
      </header>
      <div className="problems-guidance-grid">
        {items.map((item) => (
          <article key={item.key} className={`problem-guidance-card ${item.severity}`}>
            <strong>{item.title}</strong>
            <span>
              {item.count} {t("problems.items")}
            </span>
            <p>{item.nextCheck}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function ProblemsEmptyState({ loading, total, t }: { loading: boolean; total: number; t: (key: string) => string }) {
  if (loading || total > 0) return null;
  return (
    <section className="empty-state problems-empty">
      <strong>{t("problems.emptyTitle")}</strong>
      <p>{t("problems.emptyText")}</p>
    </section>
  );
}

interface GuidanceItem {
  key: string;
  title: string;
  nextCheck: string;
  severity: "critical" | "warning" | "info";
  count: number;
}

function summarizeGuidance(rows: ResourceRow[], t: (key: string) => string) {
  const buckets = new Map<string, GuidanceItem>();
  for (const row of rows) {
    const category = problemCategory(row);
    const advice = problemAdvice(row, t);
    const current = buckets.get(category);
    if (current) {
      current.count += 1;
    } else {
      buckets.set(category, {
        key: category,
        title: advice.summary,
        nextCheck: advice.nextCheck,
        severity: normalizeSeverity(readString(row, "severity", "info")),
        count: 1,
      });
    }
  }
  return Array.from(buckets.values())
    .sort((a, b) => severityRank(a.severity) - severityRank(b.severity) || b.count - a.count)
    .slice(0, 4);
}

function problemAdvice(row: ResourceRow, t: (key: string) => string) {
  const category = problemCategory(row);
  if (category !== "generic") return advice(category, t);
  const text = ["reason", "message", "phase", "status", "statusMessage", "containerProblems", "conditions", "kind"].map((key) => readString(row, key).toLowerCase()).join(" ");

  if (text.includes("crashloop") || text.includes("back-off restarting")) return advice("crashLoop", t);
  if (text.includes("imagepull") || text.includes("errimagepull") || text.includes("pull image")) return advice("imagePull", t);
  if (text.includes("unschedulable") || text.includes("pending") || text.includes("taint") || text.includes("insufficient")) return advice("scheduling", t);
  if (text.includes("notready") || text.includes("node not ready") || text.includes("nodepressure")) return advice("node", t);
  if (text.includes("persistentvolume") || text.includes("pvc") || text.includes("storageclass") || text.includes("volume")) return advice("storage", t);
  if (text.includes("restart") || text.includes("restarts")) return advice("restarts", t);
  if (text.includes("probe") || text.includes("unhealthy")) return advice("probe", t);
  if (readString(row, "kind").toLowerCase().includes("event")) return advice("event", t);
  return advice("generic", t);
}

function advice(key: string, t: (key: string) => string) {
  return {
    key,
    summary: t(`problems.advice.${key}.summary`),
    nextCheck: t(`problems.advice.${key}.next`),
  };
}

function problemOpenLocator(row: ResourceRow): ResourceRow {
  const targetResource = readString(row, "targetResource") || readString(row, "resource");
  const targetName = readString(row, "targetName") || readString(row, "name");
  const targetNamespace = readString(row, "targetNamespace") || readString(row, "namespace");
  const targetKind = readString(row, "targetKind") || readString(row, "kind");
  if (!targetResource || !targetName) return row;
  return {
    ...row,
    uid: `${targetResource}:${targetNamespace || "_cluster"}:${targetName}`,
    resource: targetResource,
    kind: targetKind,
    namespace: targetNamespace,
    name: targetName,
  } as ResourceRow;
}

function problemDiagnosticText(row: ResourceRow, cluster: Cluster | null, t: (key: string) => string) {
  const target = problemTargetLabel(row);
  const lines = [
    `${t("problems.copy.cluster")}: ${cluster?.displayName ?? ""}`,
    `${t("problems.copy.severity")}: ${readString(row, "severity")}`,
    `${t("problems.copy.category")}: ${categoryLabel(problemCategory(row), t)}`,
    `${t("problems.copy.resource")}: ${target}`,
    `${t("problems.copy.reason")}: ${readString(row, "reason")}`,
    `${t("problems.copy.message")}: ${readString(row, "message")}`,
    `${t("problems.copy.nextCheck")}: ${readString(row, "nextCheck") || problemAdvice(row, t).nextCheck}`,
  ];
  const sourceResource = `${readString(row, "resource")}/${readString(row, "namespace") || "_cluster"}/${readString(row, "name")}`;
  if (sourceResource !== target) lines.push(`${t("problems.copy.source")}: ${sourceResource}`);
  return lines.join("\n");
}

function problemTargetLabel(row: ResourceRow) {
  const targetResource = readString(row, "targetResource") || readString(row, "resource");
  const targetNamespace = readString(row, "targetNamespace") || readString(row, "namespace") || "_cluster";
  const targetName = readString(row, "targetName") || readString(row, "name");
  return `${targetResource}/${targetNamespace}/${targetName}`;
}

function problemCategory(row: ResourceRow): ProblemCategory {
  const category = readString(row, "category");
  if (["crashLoop", "imagePull", "scheduling", "node", "storage", "restarts", "probe", "deployment", "event", "podPhase", "generic"].includes(category)) {
    return category as ProblemCategory;
  }
  return "generic";
}

function categoryLabel(category: string, t: (key: string) => string) {
  return t(`problems.category.${category || "generic"}`);
}

function readString(row: ResourceRow, key: string, fallback = "") {
  const value = (row as Record<string, unknown>)[key];
  if (value === null || value === undefined) return fallback;
  return String(value);
}

function normalizeSeverity(value: unknown): "critical" | "warning" | "info" {
  const severity = String(value ?? "info").toLowerCase();
  if (severity === "critical") return "critical";
  if (severity === "warning") return "warning";
  return "info";
}

function severityRank(severity: "critical" | "warning" | "info") {
  if (severity === "critical") return 0;
  if (severity === "warning") return 1;
  return 2;
}

function rowKey(row: ResourceRow) {
  return readString(row, "uid") || `${readString(row, "namespace", "_cluster")}-${readString(row, "name")}`;
}

function uniqueSorted(values: string[]) {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}
