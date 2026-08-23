// The pieces the Problems panel is assembled from: the count bar, the filter
// row, the priority list, the guidance block and the empty state.
import type { ProblemsSummary, ResourceRow } from "../types";
import { categoryLabel, type GuidanceItem, normalizeSeverity, problemCategory, problemTargetLabel, readString, rowKey, type SeverityFilter } from "./problemsModel";

export function ProblemsSummaryBar({ summary, loading, visibleCount, t }: { summary: ProblemsSummary | null; loading: boolean; visibleCount: number; t: (key: string) => string }) {
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

export function ProblemsControls({
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

export function PriorityProblems({
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

export function ProblemsGuidance({ items, t }: { items: GuidanceItem[]; t: (key: string) => string }) {
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

export function ProblemsEmptyState({ loading, total, t }: { loading: boolean; total: number; t: (key: string) => string }) {
  if (loading || total > 0) return null;
  return (
    <section className="empty-state problems-empty">
      <strong>{t("problems.emptyTitle")}</strong>
      <p>{t("problems.emptyText")}</p>
    </section>
  );
}
