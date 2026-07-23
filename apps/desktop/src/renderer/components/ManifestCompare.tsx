import { diffLines } from "diff";
import { ChevronDown, ChevronRight, ListTree, UnfoldVertical } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { RefObject, UIEvent } from "react";
import { parse, stringify } from "yaml";
import type { ApiClient } from "../api";
import type { ResourceWorkspaceTab } from "../utils/workspaceTabs";
import { yamlFoldRegions } from "../utils/yamlFolding";
import { ThemedSelect } from "./ThemedSelect";

type DiffTone = "equal" | "changed" | "added" | "removed";
export interface ManifestDiffRow {
  left: string | null;
  right: string | null;
  leftNumber: number | null;
  rightNumber: number | null;
  leftTone: DiffTone;
  rightTone: DiffTone;
}

export function cleanManifest(source: string) {
  const value = parse(source) as Record<string, unknown>;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Manifest must contain one object");
  delete value.status;
  const metadata = value.metadata as Record<string, unknown> | undefined;
  if (metadata) {
    for (const key of ["uid", "resourceVersion", "generation", "creationTimestamp", "managedFields", "selfLink"]) delete metadata[key];
    const annotations = metadata.annotations as Record<string, unknown> | undefined;
    if (annotations) delete annotations["kubectl.kubernetes.io/last-applied-configuration"];
  }
  return stringify(sortObject(value));
}

function sortObject(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObject);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, sortObject(item)]),
  );
}

function lines(value: string) {
  const normalized = value.endsWith("\n") ? value.slice(0, -1) : value;
  return normalized ? normalized.split("\n") : [];
}

export function buildManifestDiff(left: string, right: string): ManifestDiffRow[] {
  const changes = diffLines(left, right);
  const rows: ManifestDiffRow[] = [];
  let leftNumber = 1;
  let rightNumber = 1;
  const append = (leftLines: string[], rightLines: string[], leftTone: DiffTone, rightTone: DiffTone, changedPair = false) => {
    for (let index = 0; index < Math.max(leftLines.length, rightLines.length); index += 1) {
      const leftLine = leftLines[index] ?? null;
      const rightLine = rightLines[index] ?? null;
      rows.push({
        left: leftLine,
        right: rightLine,
        leftNumber: leftLine === null ? null : leftNumber++,
        rightNumber: rightLine === null ? null : rightNumber++,
        leftTone: changedPair ? (leftLine === null ? "equal" : rightLine === null ? "removed" : "changed") : leftTone,
        rightTone: changedPair ? (rightLine === null ? "equal" : leftLine === null ? "added" : "changed") : rightTone,
      });
    }
  };

  for (let index = 0; index < changes.length; index += 1) {
    const change = changes[index];
    const next = changes[index + 1];
    if (change.removed && next?.added) {
      append(lines(change.value), lines(next.value), "changed", "changed", true);
      index += 1;
    } else if (change.added) {
      append([], lines(change.value), "equal", "added");
    } else if (change.removed) {
      append(lines(change.value), [], "removed", "equal");
    } else {
      const unchanged = lines(change.value);
      append(unchanged, unchanged, "equal", "equal");
    }
  }
  return rows;
}

type DiffFoldRange = { key: string; label: string; depth: number; start: number; end: number };
type VisibleDiffRow = { row: ManifestDiffRow; originalIndex: number; fold?: DiffFoldRange; hiddenCount?: number };

function diffFoldRanges(rows: ManifestDiffRow[], side: "left" | "right", source: string): DiffFoldRange[] {
  const numberKey = `${side}Number` as const;
  return yamlFoldRegions(source)
    .map((region) => {
      const start = rows.findIndex((row) => row[numberKey] === region.startLine);
      let end = start;
      for (let index = start; index >= 0 && index < rows.length; index += 1) {
        const line = rows[index][numberKey];
        if (line !== null && line > region.endLine) break;
        end = index;
      }
      return { key: `${side}:${region.path}`, label: region.label, depth: region.depth, start, end };
    })
    .filter((region) => region.start >= 0 && region.end > region.start);
}

function visibleDiffRows(rows: ManifestDiffRow[], ranges: DiffFoldRange[], collapsed: ReadonlySet<string>): VisibleDiffRow[] {
  const starts = new Map<number, DiffFoldRange[]>();
  for (const range of ranges) {
    const bucket = starts.get(range.start) ?? [];
    bucket.push(range);
    starts.set(range.start, bucket);
  }
  const result: VisibleDiffRow[] = [];
  for (let index = 0; index < rows.length; index += 1) {
    const candidates = (starts.get(index) ?? []).sort((left, right) => right.end - left.end);
    const fold = candidates[0];
    const active = candidates.find((candidate) => collapsed.has(candidate.key));
    result.push({ row: rows[index], originalIndex: index, fold, hiddenCount: active ? active.end - active.start : undefined });
    if (active) index = active.end;
  }
  return result;
}

function DiffPane({
  side,
  rows,
  paneRef,
  onScroll,
  onToggle,
  collapsed,
}: {
  side: "left" | "right";
  rows: VisibleDiffRow[];
  paneRef: RefObject<HTMLDivElement>;
  onScroll: (event: UIEvent<HTMLDivElement>) => void;
  onToggle: (key: string) => void;
  collapsed: ReadonlySet<string>;
}) {
  return (
    <div className={`manifest-diff-code is-${side}`} role="region" aria-label={side === "left" ? "Current manifest" : "Compared manifest"} tabIndex={0} ref={paneRef} onScroll={onScroll}>
      {rows.map(({ row, originalIndex, fold, hiddenCount }) => {
        const value = row[side];
        const number = row[`${side}Number`];
        const tone = row[`${side}Tone`];
        const isCollapsed = Boolean(fold && collapsed.has(fold.key));
        return (
          <div className={`manifest-diff-line is-${tone}`} key={`${side}-${originalIndex}`}>
            <span className="manifest-diff-number">{number ?? ""}</span>
            <span className="manifest-diff-marker">{tone === "added" ? "+" : tone === "removed" ? "−" : tone === "changed" ? "~" : "="}</span>
            <span className="manifest-diff-fold-cell">
              {fold ? (
                <button
                  className="manifest-diff-fold"
                  type="button"
                  aria-label={`${isCollapsed ? "Expand" : "Collapse"} ${fold.label}`}
                  aria-expanded={!isCollapsed}
                  onClick={() => onToggle(fold.key)}
                >
                  {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                </button>
              ) : null}
            </span>
            <code>
              {value ?? " "}
              {hiddenCount ? `  … ${hiddenCount} lines` : ""}
            </code>
          </div>
        );
      })}
    </div>
  );
}

export function ManifestCompare({
  api,
  current,
  currentYaml,
  unsaved,
  candidates,
  onClose,
}: {
  api: ApiClient;
  current: { label: string };
  currentYaml: string;
  unsaved: boolean;
  candidates: ResourceWorkspaceTab[];
  onClose: () => void;
}) {
  const [target, setTarget] = useState("");
  const [targetYaml, setTargetYaml] = useState("");
  const [raw, setRaw] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const requestRef = useRef(0);
  const leftPaneRef = useRef<HTMLDivElement>(null);
  const rightPaneRef = useRef<HTMLDivElement>(null);
  const resetScroll = () => {
    for (const pane of [leftPaneRef.current, rightPaneRef.current]) {
      if (pane) {
        pane.scrollTop = 0;
        pane.scrollLeft = 0;
      }
    }
  };
  const syncScroll = (source: HTMLDivElement, target: HTMLDivElement | null) => {
    if (!target) return;
    if (target.scrollTop !== source.scrollTop) target.scrollTop = source.scrollTop;
    if (target.scrollLeft !== source.scrollLeft) target.scrollLeft = source.scrollLeft;
  };
  useEffect(
    () => () => {
      requestRef.current += 1;
    },
    [],
  );
  const choose = async (id: string) => {
    resetScroll();
    const request = ++requestRef.current;
    setTarget(id);
    setError("");
    setTargetYaml("");
    setLoading(Boolean(id));
    if (!id) return;
    const tab = candidates.find((item) => item.id === id);
    if (!tab) {
      setLoading(false);
      return;
    }
    try {
      const yaml = await api.resourceText(tab.clusterId, tab.resource, tab.namespace, tab.row.name, "yaml");
      if (request === requestRef.current) setTargetYaml(yaml);
    } catch (cause) {
      if (request === requestRef.current) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  };
  const tab = candidates.find((item) => item.id === target);
  let left = currentYaml;
  let right = targetYaml;
  let renderError = error;
  try {
    if (!raw) {
      left = cleanManifest(left);
      right = right ? cleanManifest(right) : "";
    }
  } catch (cause) {
    renderError ||= cause instanceof Error ? cause.message : String(cause);
  }
  const rows = right
    ? buildManifestDiff(left, right)
    : lines(left).map((value, index) => ({ left: value, right: null, leftNumber: index + 1, rightNumber: null, leftTone: "equal" as const, rightTone: "equal" as const }));
  const foldRanges = useMemo(() => [...diffFoldRanges(rows, "left", left), ...(right ? diffFoldRanges(rows, "right", right) : [])], [left, right, rows]);
  const displayedRows = useMemo(() => visibleDiffRows(rows, foldRanges, collapsed), [collapsed, foldRanges, rows]);
  const toggleFold = (key: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className="modal-backdrop">
      <section className="manifest-compare">
        <header>
          <h2>Compare manifests</h2>
          <button className="icon-button" type="button" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="manifest-compare-toolbar">
          <ThemedSelect
            value={target}
            disabled={!candidates.length}
            ariaLabel="Choose resource to compare"
            options={[
              {
                value: "",
                label: candidates.length ? "Choose open resource…" : "No comparable open resources",
                title: candidates.length ? "Choose open resource to compare" : "Open another resource of the same kind to compare",
              },
              ...candidates.map((item) => ({
                value: item.id,
                label: item.row.name,
                description: `${item.clusterName} · ${item.namespace === "_cluster" ? "cluster" : item.namespace}`,
                title: `${item.clusterName} · ${item.resource} · ${item.namespace}/${item.row.name}`,
              })),
            ]}
            onChange={(id) => void choose(id)}
          />
          <div className="manifest-compare-controls">
            <div className="manifest-compare-legend" aria-label="Diff legend">
              <span className="is-equal">Same</span>
              <span className="is-changed">Changed</span>
              <span className="is-added">Added</span>
              <span className="is-removed">Removed</span>
            </div>
            <button
              className="icon-text manifest-compare-mode"
              type="button"
              onClick={() => {
                resetScroll();
                setCollapsed(new Set());
                setRaw((value) => !value);
              }}
            >
              {raw ? "Raw" : "Clean"}
            </button>
            <button
              className="icon-button"
              type="button"
              title="Collapse top-level groups"
              aria-label="Collapse top-level groups"
              onClick={() => {
                const minimumDepth = Math.min(...foldRanges.map((range) => range.depth));
                setCollapsed(new Set(foldRanges.filter((range) => range.depth === minimumDepth).map((range) => range.key)));
              }}
              disabled={!foldRanges.length}
            >
              <ListTree size={16} />
            </button>
            <button className="icon-button" type="button" title="Expand all groups" aria-label="Expand all groups" disabled={!collapsed.size} onClick={() => setCollapsed(new Set())}>
              <UnfoldVertical size={16} />
            </button>
          </div>
        </div>
        {renderError ? <p className="error-text">{renderError}</p> : null}
        <div className="manifest-compare-grid">
          <div className="manifest-context is-left" title={current.label}>
            <strong>{shortResourceName(current.label)}</strong>
            {unsaved ? <span>Unsaved</span> : null}
          </div>
          <div className="manifest-context is-right" title={tab ? `${tab.clusterName} · ${tab.namespace}/${tab.row.name}` : undefined}>
            <strong>{loading ? "Loading manifest…" : tab ? tab.row.name : "Select target"}</strong>
          </div>
          <DiffPane side="left" rows={displayedRows} collapsed={collapsed} onToggle={toggleFold} paneRef={leftPaneRef} onScroll={(event) => syncScroll(event.currentTarget, rightPaneRef.current)} />
          <DiffPane side="right" rows={displayedRows} collapsed={collapsed} onToggle={toggleFold} paneRef={rightPaneRef} onScroll={(event) => syncScroll(event.currentTarget, leftPaneRef.current)} />
        </div>
      </section>
    </div>
  );
}

function shortResourceName(label: string) {
  return label.split("/").at(-1) || label;
}
