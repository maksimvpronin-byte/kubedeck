import { diffLines } from "diff";
import { useEffect, useRef, useState } from "react";
import { parse, stringify } from "yaml";
import type { ApiClient } from "../api";
import type { ResourceWorkspaceTab } from "../utils/workspaceTabs";
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

function DiffPane({ side, rows }: { side: "left" | "right"; rows: ManifestDiffRow[] }) {
  return (
    <div className="manifest-diff-code" role="region" tabIndex={0}>
      {rows.map((row, index) => {
        const value = row[side];
        const number = row[`${side}Number`];
        const tone = row[`${side}Tone`];
        return (
          <div className={`manifest-diff-line is-${tone}`} key={`${side}-${index}`}>
            <span className="manifest-diff-number">{number ?? ""}</span>
            <span className="manifest-diff-marker">{tone === "added" ? "+" : tone === "removed" ? "−" : tone === "changed" ? "~" : "="}</span>
            <code>{value ?? " "}</code>
          </div>
        );
      })}
    </div>
  );
}

export function ManifestCompare({ api, current, currentYaml, unsaved, candidates, onClose }: { api: ApiClient; current: { label: string }; currentYaml: string; unsaved: boolean; candidates: ResourceWorkspaceTab[]; onClose: () => void }) {
  const [target, setTarget] = useState("");
  const [targetYaml, setTargetYaml] = useState("");
  const [raw, setRaw] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const requestRef = useRef(0);
  useEffect(() => () => {
    requestRef.current += 1;
  }, []);
  const choose = async (id: string) => {
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
  const rows = right ? buildManifestDiff(left, right) : lines(left).map((value, index) => ({ left: value, right: null, leftNumber: index + 1, rightNumber: null, leftTone: "equal" as const, rightTone: "equal" as const }));

  return (
    <div className="modal-backdrop">
      <section className="manifest-compare">
        <header><h2>Compare manifests</h2><button className="icon-button" type="button" onClick={onClose}>×</button></header>
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
            <div className="manifest-compare-legend" aria-label="Diff legend"><span className="is-equal">Same</span><span className="is-changed">Changed</span><span className="is-added">Added</span><span className="is-removed">Removed</span></div>
            <button className="icon-text manifest-compare-mode" type="button" onClick={() => setRaw((value) => !value)}>{raw ? "Raw" : "Clean"}</button>
          </div>
        </div>
        {renderError ? <p className="error-text">{renderError}</p> : null}
        <div className="manifest-compare-grid">
          <div><strong>{current.label}{unsaved ? " · Unsaved" : ""}</strong><DiffPane side="left" rows={rows} /></div>
          <div><strong>{loading ? "Loading manifest…" : tab ? `${tab.clusterName} · ${tab.namespace}/${tab.row.name}` : "Select target"}</strong><DiffPane side="right" rows={rows} /></div>
        </div>
      </section>
    </div>
  );
}
