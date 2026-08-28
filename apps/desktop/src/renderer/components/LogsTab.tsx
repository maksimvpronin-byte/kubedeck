import { ChevronDown, ChevronUp, Copy, Download, Search } from "lucide-react";
import type { ReactNode, RefCallback } from "react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useControlledAsyncActionFeedback } from "../hooks/useAsyncActionFeedback";
import { horizontalShift, verticalShift } from "../utils/revealMatch";
import { matchRanges, nextMatchIndex } from "../utils/searchMatches";
import { AsyncActionButton, refreshActionLabels } from "./AsyncActionButton";

// Where one occurrence sits: which of the lines on screen holds it, and the
// span inside that line.
interface LogMatch {
  line: number;
  from: number;
  to: number;
}

interface LogsTabProps {
  content: string;
  loading: boolean;
  query: string;
  onQueryChange: (value: string) => void;
  tail: number;
  onTailChange: (value: number) => void;
  previous: boolean;
  onPreviousChange: (value: boolean) => void;
  timestamps: boolean;
  onTimestampsChange: (value: boolean) => void;
  follow: boolean;
  onFollowChange: (value: boolean) => void;
  containers: string[];
  selectedContainer: string;
  onContainerChange: (value: string) => void;
  allowAllContainers?: boolean;
  targetPods?: string[];
  selectedTargetPod?: string;
  onTargetPodChange?: (value: string) => void;
  contextLabel?: string;
  fullDownloadLabel?: string;
  onRefresh: () => void;
  refreshFailed: boolean;
  t: (key: string) => string;
  onCopy: () => void;
  downloadLoading: boolean;
  onDownloadVisible: (visibleText: string) => void;
  onDownloadFull: () => Promise<void> | void;
}

export function LogsTab({
  content,
  loading,
  query,
  onQueryChange,
  tail,
  onTailChange,
  previous,
  onPreviousChange,
  timestamps,
  onTimestampsChange,
  follow,
  onFollowChange,
  containers,
  selectedContainer,
  onContainerChange,
  allowAllContainers = false,
  targetPods = [],
  selectedTargetPod = "",
  onTargetPodChange,
  contextLabel = "pod",
  fullDownloadLabel = "Full pod log",
  onRefresh,
  refreshFailed,
  t,
  onCopy,
  downloadLoading,
  onDownloadVisible,
  onDownloadFull,
}: LogsTabProps) {
  const outputRef = useRef<HTMLPreElement | null>(null);
  const stickToBottomRef = useRef(true);
  const previousContentRef = useRef(content);
  const [downloadMenuOpen, setDownloadMenuOpen] = useState(false);
  const [matchIndex, setMatchIndex] = useState(-1);
  const currentMarkRef = useRef<HTMLElement | null>(null);
  const refreshFeedback = useControlledAsyncActionFeedback(loading, refreshFailed);
  const normalizedQuery = query.trim().toLowerCase();
  const { lines, visibleLines, visibleText } = useMemo(() => {
    const allLines = content ? content.split("\n") : [];
    const filteredLines = normalizedQuery ? allLines.filter((line) => line.toLowerCase().includes(normalizedQuery)) : allLines;
    return { lines: allLines, visibleLines: filteredLines, visibleText: filteredLines.join("\n") };
  }, [content, normalizedQuery]);

  // The query still filters the lines; these are the occurrences inside what
  // survived the filter, in reading order, so the arrows step through a log the
  // way they step through a manifest.
  const matches = useMemo<LogMatch[]>(
    () => visibleLines.flatMap((line, index) => matchRanges(line, normalizedQuery).map((range) => ({ line: index, from: range.from, to: range.to }))),
    [normalizedQuery, visibleLines],
  );
  const matchesByLine = useMemo(() => {
    const byLine = new Map<number, Array<LogMatch & { index: number }>>();
    matches.forEach((match, index) => {
      const bucket = byLine.get(match.line) ?? [];
      bucket.push({ ...match, index });
      byLine.set(match.line, bucket);
    });
    return byLine;
  }, [matches]);
  // Following logs keeps adding lines under the reader, so the step reached can
  // outlive the occurrence it counted; neither the counter nor the accent may
  // point past the end.
  const currentMatch = matchIndex < matches.length ? matchIndex : -1;

  function jumpMatch(direction: 1 | -1) {
    if (matches.length === 0) return;
    setMatchIndex(nextMatchIndex(currentMatch, direction, matches.length));
  }

  // Only the log pane is scrolled, by hand rather than through scrollIntoView,
  // which would also drag the drawer around the pane. Log lines are not
  // wrapped, so the column is as much a part of "where the match is" as the
  // row: a jump that moved rows alone left the occurrence off the right edge
  // and the pane looking like it had not moved at all.
  useEffect(() => {
    const output = outputRef.current;
    const mark = currentMarkRef.current;
    if (currentMatch < 0 || !output || !mark) return;
    const outputBox = output.getBoundingClientRect();
    const markBox = mark.getBoundingClientRect();
    output.scrollTop += verticalShift(markBox.top - outputBox.top, markBox.height, output.clientHeight);
    output.scrollLeft += horizontalShift(markBox.left - outputBox.left, markBox.width, output.clientWidth);
  }, [currentMatch]);

  useLayoutEffect(() => {
    const output = outputRef.current;
    if (!output) return;

    const contentChanged = previousContentRef.current !== content;
    previousContentRef.current = content;

    if (!contentChanged) return;
    if (follow || stickToBottomRef.current) {
      output.scrollTop = output.scrollHeight;
    }
  }, [content, follow]);

  function updateScrollStickiness() {
    const output = outputRef.current;
    if (!output) return;
    const distanceFromBottom = output.scrollHeight - output.scrollTop - output.clientHeight;
    stickToBottomRef.current = distanceFromBottom < 48;
  }

  async function downloadFullAndClose() {
    await onDownloadFull();
    setDownloadMenuOpen(false);
  }

  function downloadVisibleAndClose() {
    onDownloadVisible(visibleText);
    setDownloadMenuOpen(false);
  }

  return (
    <section className="logs-viewer">
      <div className="logs-toolbar">
        {targetPods.length > 1 ? (
          <label>
            Pod
            <select value={selectedTargetPod} onChange={(event) => onTargetPodChange?.(event.target.value)}>
              <option value="">All pods</option>
              {targetPods.map((name) => (
                <option value={name} key={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {containers.length > 1 || allowAllContainers ? (
          <label>
            Container
            <select value={selectedContainer} onChange={(event) => onContainerChange(event.target.value)}>
              {allowAllContainers ? <option value="">All containers</option> : null}
              {containers.map((name) => (
                <option value={name} key={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label>
          Tail
          <select value={tail} onChange={(event) => onTailChange(Number(event.target.value))}>
            {[100, 300, 500, 1000, 2000, 5000].map((value) => (
              <option value={value} key={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label className="logs-checkbox">
          <input type="checkbox" checked={timestamps} onChange={(event) => onTimestampsChange(event.target.checked)} />
          Timestamps
        </label>
        <label className="logs-checkbox">
          <input type="checkbox" checked={previous} onChange={(event) => onPreviousChange(event.target.checked)} />
          Previous
        </label>
        <label className="logs-checkbox">
          <input type="checkbox" checked={follow} onChange={(event) => onFollowChange(event.target.checked)} />
          Follow
        </label>
        <span className="logs-action-tooltip" data-tooltip="Refresh logs">
          <AsyncActionButton
            className="icon-button logs-icon-action"
            phase={refreshFeedback.phase}
            labels={refreshActionLabels(t)}
            onClick={() => refreshFeedback.trigger(onRefresh)}
            disabled={loading}
          />
        </span>
        <span className="logs-action-tooltip" data-tooltip="Copy logs">
          <button className="icon-button logs-icon-action" onClick={onCopy} disabled={!content} aria-label="Copy logs">
            <Copy size={18} />
          </button>
        </span>
        <span className="logs-action-tooltip" data-tooltip="Download logs">
          <button className="icon-button logs-icon-action" onClick={() => setDownloadMenuOpen((current) => !current)} disabled={!content || downloadLoading} aria-label="Download logs">
            <Download size={18} />
          </button>
        </span>
      </div>
      {downloadMenuOpen ? (
        <section className="logs-download-choice" aria-label="Download logs">
          <div>
            <strong>Download logs</strong>
            <p>Choose whether to save the current loaded view or request the full {contextLabel} log from Kubernetes.</p>
          </div>
          <div className="logs-download-choice-actions">
            <button onClick={downloadVisibleAndClose} disabled={!visibleText || downloadLoading}>
              Current view
            </button>
            <button onClick={downloadFullAndClose} disabled={downloadLoading}>
              {downloadLoading ? "Downloading..." : fullDownloadLabel}
            </button>
            <button onClick={() => setDownloadMenuOpen(false)} disabled={downloadLoading}>
              Cancel
            </button>
          </div>
        </section>
      ) : null}
      <div className="logs-search-row">
        <label className="logs-search">
          <Search size={14} />
          <input
            value={query}
            onChange={(event) => {
              onQueryChange(event.target.value);
              setMatchIndex(-1);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                jumpMatch(event.shiftKey ? -1 : 1);
              }
            }}
            placeholder="Search logs"
          />
          <span>{loading ? "Refreshing..." : normalizedQuery ? `${visibleLines.length}/${lines.length}` : `${lines.length} lines`}</span>
        </label>
        <span className="match-counter">{normalizedQuery ? `${currentMatch >= 0 ? currentMatch + 1 : 0}/${matches.length}` : ""}</span>
        <span className="logs-action-tooltip" data-tooltip="Previous match (Shift+Enter)">
          <button className="icon-button logs-icon-action" disabled={matches.length === 0} onClick={() => jumpMatch(-1)} aria-label="Previous match">
            <ChevronUp size={18} />
          </button>
        </span>
        <span className="logs-action-tooltip" data-tooltip="Next match (Enter)">
          <button className="icon-button logs-icon-action" disabled={matches.length === 0} onClick={() => jumpMatch(1)} aria-label="Next match">
            <ChevronDown size={18} />
          </button>
        </span>
      </div>
      {follow ? <p className="terminal-muted">Follow mode refreshes bounded logs every 3 seconds.</p> : null}
      <pre className="logs-output" ref={outputRef} onScroll={updateScrollStickiness}>
        {visibleLines.length === 0 ? (
          <span className="terminal-muted">No log lines.</span>
        ) : (
          visibleLines.map((line, index) => (
            <span className="log-line" key={`${index}-${line.slice(0, 24)}`}>
              {renderLogLine(line, matchesByLine.get(index), currentMatch, (node) => {
                currentMarkRef.current = node;
              })}
              {index < visibleLines.length - 1 ? "\n" : ""}
            </span>
          ))
        )}
      </pre>
    </section>
  );
}

// Every occurrence in the line is marked, not just the first one, and the one
// the arrows are standing on is picked out of them. The marks are decoration
// only - the log pane is not editable, and nothing here is selected.
function renderLogLine(line: string, lineMatches: Array<LogMatch & { index: number }> | undefined, current: number, currentRef: RefCallback<HTMLElement>): ReactNode {
  if (!lineMatches?.length) return line;
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const match of lineMatches) {
    if (match.from > cursor) parts.push(line.slice(cursor, match.from));
    const isCurrent = match.index === current;
    parts.push(
      <mark className={isCurrent ? "is-current" : undefined} key={match.index} ref={isCurrent ? currentRef : undefined}>
        {line.slice(match.from, match.to)}
      </mark>,
    );
    cursor = match.to;
  }
  if (cursor < line.length) parts.push(line.slice(cursor));
  return parts;
}
