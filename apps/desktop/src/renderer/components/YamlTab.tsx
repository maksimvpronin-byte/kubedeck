import { ChevronDown, ChevronRight, ChevronUp, FileCheck2, GitCompareArrows, ListTree, Pencil, RotateCcw, Save, Search, UnfoldVertical } from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import { useAsyncActionFeedback } from "../hooks/useAsyncActionFeedback";
import { AsyncActionButton, reloadActionLabels } from "./AsyncActionButton";
import type { ApiClient } from "../api";
import type { ResourceWorkspaceTab } from "../utils/workspaceTabs";
import { visibleYamlLines, yamlFoldRegions } from "../utils/yamlFolding";
import { highlightYamlLine, YamlSourceEditor } from "./YamlSourceEditor";

const ManifestCompare = lazy(() => import("./ManifestCompare").then((module) => ({ default: module.ManifestCompare })));

interface YamlTabProps {
  yamlDraft: string;
  setYamlDraft: (value: string) => void;
  yamlChanged: boolean;
  loading: boolean;
  status: string;
  editorRef: MutableRefObject<HTMLTextAreaElement | null>;
  onReset: () => void;
  onReloadFromCluster: () => void | boolean | Promise<void | boolean>;
  onDryRun: () => void;
  onRequestApply: () => void;
  readOnly?: boolean;
  readOnlyReason?: string;
  t: (key: string) => string;
  api: ApiClient;
  current: { clusterId: string; resource: string; namespace: string; name: string; label: string };
  candidates: ResourceWorkspaceTab[];
}

export function YamlTab({
  yamlDraft,
  setYamlDraft,
  yamlChanged,
  loading,
  status,
  editorRef,
  onReset,
  onReloadFromCluster,
  onDryRun,
  onRequestApply,
  t,
  readOnly = false,
  readOnlyReason = "",
  api,
  current,
  candidates,
}: YamlTabProps) {
  const [yamlQuery, setYamlQuery] = useState("");
  const [matchIndex, setMatchIndex] = useState(-1);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const matchCount = useMemo(() => (yamlQuery ? countMatches(yamlDraft, yamlQuery) : 0), [yamlDraft, yamlQuery]);
  const reloadFeedback = useAsyncActionFeedback();
  const [compareOpen, setCompareOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const foldRegions = useMemo(() => yamlFoldRegions(yamlDraft), [yamlDraft]);
  const labels = reloadActionLabels(t);

  useEffect(() => {
    const paths = new Set(foldRegions.map((region) => region.path));
    setCollapsed((current) => new Set([...current].filter((path) => paths.has(path))));
  }, [foldRegions]);

  function jumpMatch(direction: 1 | -1) {
    if (!yamlQuery || matchCount === 0) return;
    const next = matchIndex < 0 && direction === 1 ? 0 : (matchIndex + direction + matchCount) % matchCount;
    setMatchIndex(next);
    setCollapsed(new Set());
    setEditing(true);
    window.requestAnimationFrame(() => {
      if (editorRef.current) selectMatch(editorRef.current, yamlDraft, yamlQuery, next);
    });
  }

  return (
    <>
      <div className="yaml-toolbar">
        <div className="yaml-search-row">
          <label className="yaml-search">
            <Search size={14} />
            <input
              ref={searchRef}
              value={yamlQuery}
              onChange={(event) => {
                setYamlQuery(event.target.value);
                setMatchIndex(-1);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  jumpMatch(event.shiftKey ? -1 : 1);
                }
              }}
              placeholder="Find in YAML"
            />
          </label>
          <span className="match-counter">{yamlQuery ? `${matchIndex >= 0 ? matchIndex + 1 : 0}/${matchCount}` : ""}</span>
          <span className="yaml-action-tooltip" data-tooltip="Previous match">
            <button className="icon-button yaml-icon-action" disabled={!matchCount} onClick={() => jumpMatch(-1)} aria-label="Previous match">
              <ChevronUp size={18} />
            </button>
          </span>
          <span className="yaml-action-tooltip" data-tooltip="Next match">
            <button className="icon-button yaml-icon-action" disabled={!matchCount} onClick={() => jumpMatch(1)} aria-label="Next match">
              <ChevronDown size={18} />
            </button>
          </span>
        </div>
        <div className="yaml-action-row">
          <span className="yaml-action-tooltip" data-tooltip="Reset YAML">
            <button className="icon-button yaml-icon-action" disabled={loading || !yamlChanged || readOnly} onClick={onReset} aria-label="Reset YAML">
              <RotateCcw size={18} />
            </button>
          </span>
          <span className="yaml-action-tooltip" data-tooltip="Reload YAML from cluster">
            <AsyncActionButton className="icon-button yaml-icon-action" phase={reloadFeedback.phase} labels={labels} disabled={loading} onClick={() => void reloadFeedback.run(onReloadFromCluster)} />
          </span>
          <span className="yaml-action-tooltip" data-tooltip="Dry-run YAML">
            <button className="icon-button yaml-icon-action" disabled={loading || yamlDraft.trim() === "" || readOnly} onClick={onDryRun} aria-label="Dry-run YAML">
              <FileCheck2 size={18} />
            </button>
          </span>
          <span className="yaml-action-tooltip" data-tooltip="Apply YAML">
            <button className="icon-button yaml-icon-action primary" disabled={loading || yamlDraft.trim() === "" || !yamlChanged || readOnly} onClick={onRequestApply} aria-label="Apply YAML">
              <Save size={18} />
            </button>
          </span>
          <span className="yaml-action-tooltip" data-tooltip={candidates.length ? "Compare with open resource" : "Open another resource tab of the same kind"}>
            <button className="icon-button yaml-icon-action" disabled={!candidates.length || !yamlDraft} aria-label="Compare YAML" onClick={() => setCompareOpen(true)}>
              <GitCompareArrows size={18} />
            </button>
          </span>
          {!readOnly ? (
            <span className="yaml-action-tooltip" data-tooltip={editing ? "Fold view" : "Edit full YAML"}>
              <button
                className="icon-button yaml-icon-action"
                aria-label={editing ? "Open fold view" : "Edit full YAML"}
                onClick={() => {
                  setCollapsed(new Set());
                  setEditing((current) => !current);
                }}
              >
                {editing ? <ListTree size={18} /> : <Pencil size={18} />}
              </button>
            </span>
          ) : null}
          <span className="yaml-action-tooltip" data-tooltip="Collapse top-level groups">
            <button
              className="icon-button yaml-icon-action"
              disabled={editing || foldRegions.length === 0}
              aria-label="Collapse top-level YAML groups"
              onClick={() => {
                const minimumDepth = Math.min(...foldRegions.map((region) => region.depth));
                setCollapsed(new Set(foldRegions.filter((region) => region.depth === minimumDepth).map((region) => region.path)));
              }}
            >
              <ListTree size={18} />
            </button>
          </span>
          <span className="yaml-action-tooltip" data-tooltip="Expand all groups">
            <button className="icon-button yaml-icon-action" disabled={editing || collapsed.size === 0} aria-label="Expand all YAML groups" onClick={() => setCollapsed(new Set())}>
              <UnfoldVertical size={18} />
            </button>
          </span>
          {readOnly && readOnlyReason ? <span className="yaml-readonly-indicator">{readOnlyReason}</span> : null}
          {yamlChanged ? <span className="yaml-dirty-indicator">modified · auto-refresh paused</span> : null}
          {status ? (
            <span className="apply-result" role="status" aria-live="polite">
              {status}
            </span>
          ) : null}
        </div>
      </div>
      {compareOpen ? (
        <Suspense fallback={null}>
          <ManifestCompare api={api} current={current} currentYaml={yamlDraft} unsaved={yamlChanged} candidates={candidates} onClose={() => setCompareOpen(false)} />
        </Suspense>
      ) : null}
      {!editing ? (
        <FoldedYamlView
          source={yamlDraft}
          collapsed={collapsed}
          regions={foldRegions}
          onToggle={(path) =>
            setCollapsed((current) => {
              const next = new Set(current);
              if (next.has(path)) next.delete(path);
              else next.add(path);
              return next;
            })
          }
        />
      ) : (
        <YamlSourceEditor
          value={yamlDraft}
          readOnly={readOnly}
          editorRef={editorRef}
          onChange={setYamlDraft}
          onKeyDown={(event) => {
            if (event.key === "Enter" && yamlQuery && matchCount > 0) {
              event.preventDefault();
              jumpMatch(event.shiftKey ? -1 : 1);
            }
          }}
        />
      )}
    </>
  );
}

function FoldedYamlView({ source, regions, collapsed, onToggle }: { source: string; regions: ReturnType<typeof yamlFoldRegions>; collapsed: ReadonlySet<string>; onToggle: (path: string) => void }) {
  const starts = new Map(regions.map((region) => [region.startLine, region]));
  return (
    <div className="yaml-fold-view yaml-editor" role="region" aria-label="YAML manifest" tabIndex={0}>
      {visibleYamlLines(source, regions, collapsed).map(({ line, lineNumber, hiddenCount }) => {
        const region = starts.get(lineNumber);
        const isCollapsed = Boolean(region && collapsed.has(region.path));
        return (
          <span className="yaml-line" key={lineNumber}>
            <span className="yaml-fold-gutter">
              {region ? (
                <button
                  type="button"
                  aria-label={`${isCollapsed ? "Expand" : "Collapse"} ${region.label}`}
                  aria-expanded={!isCollapsed}
                  title={`${isCollapsed ? "Expand" : "Collapse"} ${region.label}`}
                  onClick={() => onToggle(region.path)}
                >
                  {isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                </button>
              ) : null}
            </span>
            <span className="yaml-line-number">{lineNumber}</span>
            <span className="yaml-line-code">{highlightYamlLine(line)}</span>
            {hiddenCount ? <span className="yaml-fold-summary"> … {hiddenCount} lines</span> : null}
            {"\n"}
          </span>
        );
      })}
    </div>
  );
}

function countMatches(text: string, query: string) {
  if (!query) return 0;
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  let count = 0;
  let index = lowerText.indexOf(lowerQuery);
  while (index !== -1) {
    count += 1;
    index = lowerText.indexOf(lowerQuery, index + lowerQuery.length);
  }
  return count;
}

function selectMatch(element: HTMLTextAreaElement, text: string, query: string, targetIndex: number) {
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  let index = -1;
  let from = 0;
  for (let i = 0; i <= targetIndex; i += 1) {
    index = lowerText.indexOf(lowerQuery, from);
    if (index === -1) return;
    from = index + lowerQuery.length;
  }
  element.focus();
  element.setSelectionRange(index, index + query.length);
  const lineHeight = 16;
  const line = text.slice(0, index).split("\n").length;
  element.scrollTop = Math.max(0, (line - 6) * lineHeight);
}
