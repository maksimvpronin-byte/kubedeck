import { Lock, Plus, TriangleAlert, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { NodeLabelTarget } from "../hooks/useBulkResourceActions";
import {
  isSystemNodeLabel,
  nodeLabelCommandPreview,
  nodeLabelKeyProblem,
  nodeLabelStats,
  nodeLabelValueProblem,
  planNodeLabelChanges,
  type NodeLabelChanges,
  type NodeLabelOperation,
  type NodeLabelStat,
} from "../utils/nodeLabels";

type Mode = "keep" | "set" | "remove";

interface Choice {
  mode: Exclude<Mode, "keep">;
  value: string;
}

interface Props {
  target: NodeLabelTarget | null;
  t: (key: string) => string;
  onClose: () => void;
  onConfirm: (changes: NodeLabelChanges) => void;
}

const fill = (template: string, values: Record<string, string | number>) => Object.entries(values).reduce((text, [key, value]) => text.split(`{${key}}`).join(String(value)), template);

// The labels of every selected node, each with how many of them carry it, and a
// choice per label: keep it, set one value on all, or remove it. What each node
// will get, and the command that does it, is on screen before anything is sent.
export function NodeLabelsModal({ target, t, onClose, onConfirm }: Props) {
  if (!target) return null;
  return <NodeLabelsDialog target={target} t={t} onClose={onClose} onConfirm={onConfirm} />;
}

function NodeLabelsDialog({ target, t, onClose, onConfirm }: Props & { target: NodeLabelTarget }) {
  const { rows } = target;
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [additions, setAdditions] = useState<Array<{ key: string; value: string }>>([]);
  const [draftKey, setDraftKey] = useState("");
  const [draftValue, setDraftValue] = useState("");
  const dialogRef = useRef<HTMLDivElement>(null);
  const keyInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => dialogRef.current?.focus(), []);

  const stats = useMemo(() => nodeLabelStats(rows), [rows]);
  const ownStats = stats.filter((stat) => !isSystemNodeLabel(stat.key));
  const systemStats = stats.filter((stat) => isSystemNodeLabel(stat.key));

  const changes = useMemo<NodeLabelChanges>(() => {
    const set: Record<string, string> = {};
    const remove: string[] = [];
    for (const [key, choice] of Object.entries(choices)) {
      if (choice.mode === "set") set[key] = choice.value;
      else remove.push(key);
    }
    for (const addition of additions) set[addition.key] = addition.value;
    return { set, remove };
  }, [choices, additions]);

  const plan = useMemo(() => planNodeLabelChanges(rows, changes), [rows, changes]);
  const operationCount = plan.reduce((sum, entry) => sum + entry.operations.length, 0);
  const changedNodes = plan.filter((entry) => entry.operations.length).length;
  const invalidValue = Object.values(changes.set).some((value) => nodeLabelValueProblem(value));

  const trimmedKey = draftKey.trim();
  const trimmedValue = draftValue.trim();
  const keyProblem = trimmedKey ? nodeLabelKeyProblem(trimmedKey) : "empty";
  const valueProblem = nodeLabelValueProblem(trimmedValue);
  const draftProblem = trimmedKey || trimmedValue ? (keyProblem ?? valueProblem) : null;

  const choose = (stat: NodeLabelStat, mode: Mode) => {
    setChoices((current) => {
      const next = { ...current };
      if (mode === "keep") delete next[stat.key];
      else next[stat.key] = { mode, value: current[stat.key]?.value ?? (stat.values.length === 1 ? stat.values[0].value : "") };
      return next;
    });
  };

  const addDraft = () => {
    if (keyProblem || valueProblem) return;
    // A key the nodes already carry is the same as choosing "set" on its row.
    if (stats.some((stat) => stat.key === trimmedKey)) {
      setChoices((current) => ({ ...current, [trimmedKey]: { mode: "set", value: trimmedValue } }));
    } else {
      setAdditions((current) => [...current.filter((addition) => addition.key !== trimmedKey), { key: trimmedKey, value: trimmedValue }]);
    }
    setDraftKey("");
    setDraftValue("");
    keyInputRef.current?.focus();
  };

  const labelRow = (stat: NodeLabelStat) => {
    const choice = choices[stat.key];
    const mode: Mode = choice?.mode ?? "keep";
    const system = isSystemNodeLabel(stat.key);
    return (
      <div className={`node-labels-row is-${mode}`} key={stat.key}>
        <code className="node-labels-key" title={stat.key}>
          {stat.key}
        </code>
        <span className={`node-labels-coverage ${stat.count === rows.length ? "is-full" : ""}`} title={fill(t("nodeLabels.coverageTitle"), { count: stat.count, total: rows.length })}>
          {fill(t("nodeLabels.coverage"), { count: stat.count, total: rows.length })}
        </span>
        {mode === "set" ? (
          <input
            className={`node-labels-input ${nodeLabelValueProblem(choice.value) ? "is-invalid" : ""}`}
            value={choice.value}
            placeholder={t("nodeLabels.emptyValue")}
            aria-label={fill(t("nodeLabels.valueLabel"), { key: stat.key })}
            spellCheck={false}
            autoFocus
            onChange={(event) => {
              const value = event.target.value;
              setChoices((current) => ({ ...current, [stat.key]: { mode: "set", value } }));
            }}
          />
        ) : (
          <span className="node-labels-values" title={stat.values.map((item) => `${item.value || '""'} × ${item.count}`).join("\n")}>
            {stat.values.map((item, index) => (
              <span key={item.value}>
                {index > 0 ? " · " : ""}
                {item.value || '""'}
                {stat.values.length > 1 || item.count !== rows.length ? <em> ×{item.count}</em> : null}
              </span>
            ))}
          </span>
        )}
        <span className="node-labels-modes" role="group" aria-label={stat.key}>
          {(["keep", "set", "remove"] as const).map((option) => (
            <button key={option} type="button" className={`is-${option} ${mode === option ? "is-active" : ""}`} aria-pressed={mode === option} onClick={() => choose(stat, option)}>
              {t(`nodeLabels.${option}`)}
            </button>
          ))}
        </span>
        {system ? <TriangleAlert className="node-labels-system-icon" size={13} aria-label={t("nodeLabels.systemWarning")} /> : null}
      </div>
    );
  };

  return (
    <div
      className="node-action-confirm-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="node-action-confirm-modal node-labels-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="node-labels-title"
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            onClose();
          }
        }}
      >
        <div className="node-action-confirm-header">
          <div>
            <div className="node-action-confirm-kicker">{t("nodeLabels.kicker")}</div>
            <h2 id="node-labels-title">{fill(t("nodeLabels.title"), { count: rows.length })}</h2>
            <p>{t("nodeLabels.intro")}</p>
          </div>
          <button className="icon-button" type="button" aria-label={t("common.close")} title={t("common.close")} onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="node-action-confirm-section">
          <div className="node-action-confirm-node-list" aria-label={t("nodeLabels.nodes")}>
            {rows.map((row) => (
              <code key={String(row.name)}>{String(row.name)}</code>
            ))}
          </div>
        </div>

        <div className="node-action-confirm-section">
          <div className="node-action-confirm-label">{t("nodeLabels.current")}</div>
          <div className="node-labels-rows">{ownStats.length ? ownStats.map(labelRow) : <p className="node-labels-note">{t("nodeLabels.none")}</p>}</div>
          {systemStats.length ? (
            <details className="node-labels-system" open={systemStats.some((stat) => choices[stat.key]) || undefined}>
              <summary>
                {fill(t("nodeLabels.system"), { count: systemStats.length })} · <span>{t("nodeLabels.systemWarning")}</span>
              </summary>
              <div className="node-labels-rows">{systemStats.map(labelRow)}</div>
            </details>
          ) : null}
          <p className="node-labels-note">
            <Lock size={12} /> {t("nodeLabels.protectedNote")}
          </p>
        </div>

        <div className="node-action-confirm-section">
          <div className="node-action-confirm-label">{t("nodeLabels.add")}</div>
          {additions.length ? (
            <div className="node-labels-rows">
              {additions.map((addition) => (
                <div className="node-labels-row is-set" key={addition.key}>
                  <code className="node-labels-key" title={addition.key}>
                    {addition.key}
                  </code>
                  <span className="node-labels-coverage">{t("nodeLabels.new")}</span>
                  <span className="node-labels-values">{addition.value || '""'}</span>
                  <button
                    className="icon-button"
                    type="button"
                    aria-label={`${t("nodeLabels.removeAddition")}: ${addition.key}`}
                    title={t("nodeLabels.removeAddition")}
                    onClick={() => setAdditions((current) => current.filter((item) => item.key !== addition.key))}
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          ) : null}
          <form
            className="node-labels-add"
            onSubmit={(event) => {
              event.preventDefault();
              addDraft();
            }}
          >
            <input
              ref={keyInputRef}
              className={`node-labels-input ${trimmedKey && keyProblem ? "is-invalid" : ""}`}
              value={draftKey}
              placeholder={t("nodeLabels.keyPlaceholder")}
              aria-label={t("nodeLabels.keyPlaceholder")}
              list="node-labels-known-keys"
              spellCheck={false}
              onChange={(event) => setDraftKey(event.target.value)}
            />
            <span className="node-labels-equals">=</span>
            <input
              className={`node-labels-input ${valueProblem ? "is-invalid" : ""}`}
              value={draftValue}
              placeholder={t("nodeLabels.valuePlaceholder")}
              aria-label={t("nodeLabels.valuePlaceholder")}
              spellCheck={false}
              onChange={(event) => setDraftValue(event.target.value)}
            />
            <button className="secondary-btn" type="submit" disabled={Boolean(keyProblem || valueProblem)}>
              <Plus size={14} /> {t("nodeLabels.addButton")}
            </button>
          </form>
          <datalist id="node-labels-known-keys">
            {stats.map((stat) => (
              <option key={stat.key} value={stat.key} />
            ))}
          </datalist>
          <p className="node-labels-error" role="status">
            {draftProblem ? t(`nodeLabels.error.${draftProblem}`) : ""}
          </p>
        </div>

        <div className="node-action-confirm-section">
          <div className="node-action-confirm-label">{t("nodeLabels.changes")}</div>
          <div className="node-labels-diff">
            {plan.map((entry) => (
              <div className="node-labels-diff-row" key={String(entry.row.name)}>
                <code>{String(entry.row.name)}</code>
                <span>
                  {entry.operations.length ? (
                    entry.operations.map((operation) => <OperationChip key={`${operation.kind}:${operation.key}`} operation={operation} />)
                  ) : (
                    <span className="node-labels-op is-none">{t("nodeLabels.noChange")}</span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="node-action-confirm-section">
          <div className="node-action-confirm-label">{t("nodeLabels.command")}</div>
          <pre className="node-action-confirm-command">{nodeLabelCommandPreview(plan) || t("nodeLabels.commandEmpty")}</pre>
        </div>

        <div className="node-action-confirm-actions node-labels-actions modal-actions">
          <span className="node-labels-summary">{operationCount ? fill(t("nodeLabels.summary"), { changes: operationCount, nodes: changedNodes }) : t("nodeLabels.summaryNone")}</span>
          <button className="secondary" type="button" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button className="primary" type="button" disabled={!operationCount || invalidValue} onClick={() => onConfirm(changes)}>
            {t("nodeLabels.apply")}
          </button>
        </div>
      </div>
    </div>
  );
}

function OperationChip({ operation }: { operation: NodeLabelOperation }) {
  if (operation.kind === "add") {
    return <span className="node-labels-op is-add">+ {`${operation.key}=${operation.value}`}</span>;
  }
  if (operation.kind === "change") {
    return <span className="node-labels-op is-change">~ {`${operation.key}: ${operation.from || '""'} → ${operation.value || '""'}`}</span>;
  }
  return <span className="node-labels-op is-remove">− {operation.key}</span>;
}
