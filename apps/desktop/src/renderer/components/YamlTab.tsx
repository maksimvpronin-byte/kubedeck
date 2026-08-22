import { ChevronDown, ChevronUp, FileCheck2, GitCompareArrows, ListTree, RotateCcw, Save, Search, UnfoldVertical } from "lucide-react";
import type { MutableRefObject } from "react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ApiClient } from "../api";
import { useAsyncActionFeedback } from "../hooks/useAsyncActionFeedback";
import { matchRanges, nextMatchIndex } from "../utils/searchMatches";
import type { ResourceWorkspaceTab } from "../utils/workspaceTabs";
import { yamlFoldRegions } from "../utils/yamlFolding";
import { AsyncActionButton, reloadActionLabels } from "./AsyncActionButton";
import { type YamlEditorHandle, YamlSourceEditor } from "./YamlSourceEditor";

const ManifestCompare = lazy(() => import("./ManifestCompare").then((module) => ({ default: module.ManifestCompare })));

interface YamlTabProps {
  yamlDraft: string;
  setYamlDraft: (value: string) => void;
  yamlChanged: boolean;
  loading: boolean;
  status: string;
  editorRef: MutableRefObject<YamlEditorHandle | null>;
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
  const matches = useMemo(() => matchRanges(yamlDraft, yamlQuery), [yamlDraft, yamlQuery]);
  const matchCount = matches.length;
  // An edit can leave the draft with fewer matches than the step the reader had
  // reached, and neither the counter nor the highlight may point past the end.
  const currentMatch = matchIndex < matchCount ? matchIndex : -1;
  const reloadFeedback = useAsyncActionFeedback();
  const [compareOpen, setCompareOpen] = useState(false);
  // CodeMirror owns the fold state; this is the mirror it reports back, and the
  // only thing the toolbar needs from it is whether its buttons would still do
  // anything.
  const [foldedLines, setFoldedLines] = useState<number[]>([]);
  const foldRegions = useMemo(() => yamlFoldRegions(yamlDraft), [yamlDraft]);
  const topLevelFoldRegions = useMemo(() => {
    if (foldRegions.length === 0) return [];
    const minimumDepth = Math.min(...foldRegions.map((region) => region.depth));
    return foldRegions.filter((region) => region.depth === minimumDepth);
  }, [foldRegions]);
  // Collapse folds the whole top level at once, so the button is spent once
  // every one of those regions is already folded - clicking again would be a
  // no-op.
  const collapseIsNoOp = topLevelFoldRegions.length === 0 || topLevelFoldRegions.every((region) => foldedLines.includes(region.startLine));
  const labels = reloadActionLabels(t);

  // The highlight is repainted whenever the draft or the query changes, because
  // the ranges are recomputed from the draft: a match can never end up painted
  // over text that has since moved. A repaint never scrolls - only a jump does.
  useEffect(() => {
    editorRef.current?.showSearchMatches(matches, currentMatch, false);
  }, [currentMatch, editorRef, matches]);

  const jumpMatch = useCallback(
    (direction: 1 | -1) => {
      const handle = editorRef.current;
      if (matchCount === 0 || !handle) return;
      const next = nextMatchIndex(currentMatch, direction, matchCount);
      setMatchIndex(next);
      // A match can sit inside a folded region, where the highlight would be
      // hidden behind the placeholder, so every fold is opened before revealing.
      handle.unfoldAll();
      handle.showSearchMatches(matches, next, true);
    },
    [currentMatch, editorRef, matchCount, matches],
  );

  const findNext = useCallback(() => jumpMatch(1), [jumpMatch]);
  const findPrevious = useCallback(() => jumpMatch(-1), [jumpMatch]);

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
          <span className="match-counter">{yamlQuery ? `${currentMatch >= 0 ? currentMatch + 1 : 0}/${matchCount}` : ""}</span>
          <span className="yaml-action-tooltip" data-tooltip="Previous match (Shift+F3)">
            <button className="icon-button yaml-icon-action" disabled={!matchCount} onClick={() => jumpMatch(-1)} aria-label="Previous match">
              <ChevronUp size={18} />
            </button>
          </span>
          <span className="yaml-action-tooltip" data-tooltip="Next match (F3)">
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
          <span className="yaml-action-tooltip" data-tooltip="Collapse top-level groups">
            <button
              className="icon-button yaml-icon-action"
              disabled={collapseIsNoOp}
              aria-label="Collapse top-level YAML groups"
              onClick={() => editorRef.current?.foldLineRanges(topLevelFoldRegions)}
            >
              <ListTree size={18} />
            </button>
          </span>
          <span className="yaml-action-tooltip" data-tooltip="Expand all groups">
            <button className="icon-button yaml-icon-action" disabled={foldedLines.length === 0} aria-label="Expand all YAML groups" onClick={() => editorRef.current?.unfoldAll()}>
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
      <YamlSourceEditor
        value={yamlDraft}
        onChange={setYamlDraft}
        readOnly={readOnly}
        ariaLabel="YAML manifest"
        editorRef={editorRef}
        onFoldedLinesChange={setFoldedLines}
        onFindNext={findNext}
        onFindPrevious={findPrevious}
      />
    </>
  );
}
