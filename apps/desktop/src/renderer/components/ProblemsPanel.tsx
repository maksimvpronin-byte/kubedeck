import { useEffect, useMemo, useRef, useState } from "react";
import type { ApiClient } from "../api";
import type { Cluster, ErrorInfo, ProblemsSummary, ResourceRow, Settings } from "../types";
import { asErrorInfo, isAbortError } from "../utils/errors";
import { getAutoRefreshIntervalSeconds, shouldSkipSilentRefresh } from "../utils/refresh";
import { ErrorPanel } from "./ErrorPanel";
import { ResourceTable } from "./ResourceTable";
import { refreshActionLabels } from "./AsyncActionButton";
import { categoryLabel, problemAdvice, problemCategory, problemDiagnosticText, problemOpenLocator, readString, rowKey, type SeverityFilter, summarizeGuidance, uniqueSorted } from "./problemsModel";
import { PriorityProblems, ProblemsControls, ProblemsEmptyState, ProblemsGuidance, ProblemsSummaryBar } from "./ProblemsPanelParts";

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
    if (shouldSkipSilentRefresh(silent, requestRef.current !== null)) return false;
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

  // Unlike the resource table, this panel keeps polling even when watches are
  // healthy - and deliberately so: a watch is opened for the one resource the
  // table shows, and while this panel is the active section there is no watch
  // open at all. There is nothing here for `shouldPollResources` to consult.
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
